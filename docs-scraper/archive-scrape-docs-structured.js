const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// Configuration
const BASE_URL = 'https://arena.screeps.com/docs/';
const OUTPUT_DIR = '../screeps-docs-structured';

// Utility to make HTTP requests
function fetch(url) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const client = parsedUrl.protocol === 'https:' ? https : http;

        client.get(url, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                return fetch(res.headers.location).then(resolve).catch(reject);
            }

            if (res.statusCode !== 200) {
                reject(new Error(`Status Code: ${res.statusCode}`));
                return;
            }

            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

// Extract text content from HTML (basic version)
function extractTextContent(html) {
    // Remove script and style tags
    let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

    // Remove HTML tags but keep structure
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/p>/gi, '\n\n');
    text = text.replace(/<\/div>/gi, '\n');
    text = text.replace(/<\/h[1-6]>/gi, '\n\n');
    text = text.replace(/<[^>]+>/g, '');

    // Decode HTML entities
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");

    // Clean up whitespace
    text = text.replace(/\n\s*\n\s*\n/g, '\n\n');
    text = text.trim();

    return text;
}

// Extract sections based on navigation structure
function extractSections(html) {
    const sections = [];

    // Extract navigation items with proper structure
    const navRegex = /<div class="nav-root[^"]*"[^>]*data-type="[^"]*"><a href="#([^"]+)">([^<]+)<\/a>([\s\S]*?)(?=<div class="nav-root|<\/nav>)/g;
    let match;

    while ((match = navRegex.exec(html)) !== null) {
        const [, id, title, content] = match;

        // Extract nested items
        const nestedItems = [];
        const nestedRegex = /<div class="nav-nested[^"]*"[^>]*><a href="#([^"]+)">([^<]+)<\/a>/g;
        let nestedMatch;

        while ((nestedMatch = nestedRegex.exec(content)) !== null) {
            nestedItems.push({
                id: nestedMatch[1],
                title: nestedMatch[2]
            });
        }

        sections.push({
            id,
            title,
            nestedItems
        });
    }

    return sections;
}

// Extract content for a specific section ID
function extractSectionContent(html, sectionId) {
    // Try to find the section content by its ID
    const sectionRegex = new RegExp(`<[^>]*id="${sectionId}"[^>]*>([\\s\\S]*?)(?=<[^>]*id="|$)`, 'i');
    const match = html.match(sectionRegex);

    if (match) {
        return extractTextContent(match[0]);
    }

    return null;
}

// Create directory recursively
function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

// Sanitize filename
function sanitizeFilename(name) {
    return name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
}

// Main function
async function scrapeAndStructure() {
    console.log('Screeps Arena Documentation Structured Scraper');
    console.log('==============================================\n');
    console.log(`Fetching documentation from: ${BASE_URL}`);

    try {
        // Fetch the main page
        console.log('Downloading main documentation page...');
        const html = await fetch(BASE_URL);

        // Create output directories
        ensureDir(OUTPUT_DIR);
        ensureDir(path.join(OUTPUT_DIR, 'sections'));

        // Save the full HTML
        console.log('\n✓ Saving complete HTML file...');
        fs.writeFileSync(path.join(OUTPUT_DIR, 'full-docs.html'), html, 'utf8');

        // Extract navigation structure
        console.log('✓ Extracting navigation structure...');
        const sections = extractSections(html);

        // Save navigation structure as JSON
        fs.writeFileSync(
            path.join(OUTPUT_DIR, 'navigation.json'),
            JSON.stringify(sections, null, 2),
            'utf8'
        );
        console.log(`✓ Found ${sections.length} main sections\n`);

        // Extract and save each section
        console.log('Extracting individual sections:');
        console.log('===============================');

        for (const section of sections) {
            const filename = sanitizeFilename(section.title);
            const sectionDir = path.join(OUTPUT_DIR, 'sections', filename);
            ensureDir(sectionDir);

            // Create a markdown file for the section
            let markdown = `# ${section.title}\n\n`;
            markdown += `ID: \`${section.id}\`\n\n`;

            if (section.nestedItems.length > 0) {
                markdown += `## Contents\n\n`;
                for (const item of section.nestedItems) {
                    markdown += `- [${item.title}](#${item.id})\n`;
                }
                markdown += '\n';
            }

            // Try to extract content
            const content = extractSectionContent(html, section.id);
            if (content) {
                markdown += `## Details\n\n${content}\n\n`;
            }

            // Add nested items
            for (const item of section.nestedItems) {
                const itemContent = extractSectionContent(html, item.id);
                if (itemContent) {
                    markdown += `### ${item.title}\n\n`;
                    markdown += `${itemContent}\n\n`;
                }
            }

            fs.writeFileSync(
                path.join(sectionDir, 'README.md'),
                markdown,
                'utf8'
            );

            console.log(`✓ ${section.title} (${section.nestedItems.length} sub-items)`);
        }

        // Create index file
        console.log('\n✓ Creating index...');
        let indexMd = `# Screeps Arena API Documentation\n\n`;
        indexMd += `Downloaded: ${new Date().toISOString()}\n\n`;
        indexMd += `Source: ${BASE_URL}\n\n`;
        indexMd += `## Sections\n\n`;

        for (const section of sections) {
            const filename = sanitizeFilename(section.title);
            indexMd += `- [${section.title}](sections/${filename}/README.md) (${section.nestedItems.length} items)\n`;
        }

        fs.writeFileSync(
            path.join(OUTPUT_DIR, 'README.md'),
            indexMd,
            'utf8'
        );

        // Extract and save text-only version
        console.log('✓ Creating text-only version...');
        const fullText = extractTextContent(html);
        fs.writeFileSync(
            path.join(OUTPUT_DIR, 'full-docs.txt'),
            fullText,
            'utf8'
        );

        console.log('\n==============================================');
        console.log('Documentation successfully structured!');
        console.log(`\nOutput directory: ${OUTPUT_DIR}`);
        console.log('\nFiles created:');
        console.log('  - full-docs.html (complete HTML)');
        console.log('  - full-docs.txt (text-only version)');
        console.log('  - navigation.json (structure data)');
        console.log('  - README.md (index)');
        console.log(`  - sections/ (${sections.length} organized sections)\n`);

    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

// Run the scraper
scrapeAndStructure();
