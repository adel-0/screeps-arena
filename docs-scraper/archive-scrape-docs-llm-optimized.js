const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// Configuration
const BASE_URL = 'https://arena.screeps.com/docs/';
const OUTPUT_DIR = '../screeps-docs-llm';

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

// Rough token estimation (1 token ≈ 4 characters)
function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}

// Extract and parse the React/Next.js page data
function extractPageData(html) {
    // Look for the Next.js data in script tags
    const scriptRegex = /<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s;
    const match = html.match(scriptRegex);

    if (match) {
        try {
            const data = JSON.parse(match[1]);
            return data;
        } catch (e) {
            console.error('Failed to parse Next.js data:', e.message);
        }
    }

    return null;
}

// Parse navigation structure from HTML
function parseNavigation(html) {
    const sections = [];
    const navRegex = /<div class="nav-root[^"]*"[^>]*data-type="([^"]*)"[^>]*><a href="#([^"]+)">([^<]+)<\/a>([\s\S]*?)(?=<div class="nav-root|<\/nav>)/g;
    let match;

    while ((match = navRegex.exec(html)) !== null) {
        const [, dataType, id, title, content] = match;

        const nestedItems = [];
        const nestedRegex = /<div class="nav-nested[^"]*"[^>]*data-type="([^"]*)"[^>]*><a href="#([^"]+)">([^<]+)<\/a>/g;
        let nestedMatch;

        while ((nestedMatch = nestedRegex.exec(content)) !== null) {
            nestedItems.push({
                type: nestedMatch[1] || 'property',
                id: nestedMatch[2],
                title: nestedMatch[3]
            });
        }

        sections.push({
            id,
            title,
            type: dataType || 'object',
            items: nestedItems
        });
    }

    return sections;
}

// Extract clean content for a section
function extractSectionContent(html, sectionId) {
    // Find section by ID attribute
    const sectionRegex = new RegExp(`<[^>]*\\sid="${sectionId}"[^>]*>([\\s\\S]*?)(?=<[^>]*\\sid="|$)`, 'i');
    const match = html.match(sectionRegex);

    if (!match) return null;

    let content = match[1];

    // Remove script and style tags
    content = content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    content = content.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

    // Convert common HTML elements to markdown
    content = content.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n# $1\n');
    content = content.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n');
    content = content.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n');
    content = content.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '\n#### $1\n');
    content = content.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
    content = content.replace(/<br\s*\/?>/gi, '\n');
    content = content.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');
    content = content.replace(/<pre[^>]*>(.*?)<\/pre>/gis, '\n```\n$1\n```\n');
    content = content.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
    content = content.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
    content = content.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
    content = content.replace(/<ul[^>]*>/gi, '\n');
    content = content.replace(/<\/ul>/gi, '\n');

    // Remove remaining HTML tags
    content = content.replace(/<[^>]+>/g, '');

    // Decode HTML entities
    content = content.replace(/&nbsp;/g, ' ');
    content = content.replace(/&lt;/g, '<');
    content = content.replace(/&gt;/g, '>');
    content = content.replace(/&amp;/g, '&');
    content = content.replace(/&quot;/g, '"');
    content = content.replace(/&#39;/g, "'");
    content = content.replace(/&#x27;/g, "'");
    content = content.replace(/&apos;/g, "'");

    // Clean up excessive whitespace
    content = content.replace(/\n\s*\n\s*\n/g, '\n\n');
    content = content.trim();

    return content;
}

// Categorize section type
function categorizeSection(section) {
    const title = section.title.toLowerCase();
    const id = section.id.toLowerCase();

    if (title.startsWith('structure') || id.includes('structure')) {
        return 'structure';
    } else if (title.match(/^[a-z]+$/i) && title[0] === title[0].toUpperCase()) {
        return 'class';
    } else if (id.includes('effect_') || id.includes('resource_')) {
        return 'constant';
    } else if (section.items.length === 0 && !title.includes('info')) {
        return 'function';
    } else if (title.includes('info')) {
        return 'global';
    }

    return 'object';
}

// Create directory recursively
function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

// Main scraper
async function scrape() {
    console.log('Screeps Arena LLM-Optimized Documentation Scraper');
    console.log('==================================================\n');

    try {
        // Fetch HTML
        console.log('Fetching documentation...');
        const html = await fetch(BASE_URL);

        // Setup output
        ensureDir(OUTPUT_DIR);

        // Parse navigation
        console.log('Parsing structure...');
        const sections = parseNavigation(html);
        console.log(`Found ${sections.length} sections\n`);

        // Prepare data structures
        const allChunks = [];
        const markdown = [];

        console.log('Processing sections:');
        console.log('====================');

        // Process each section
        for (const section of sections) {
            const category = categorizeSection(section);
            const content = extractSectionContent(html, section.id);

            if (!content) {
                console.log(`⚠ ${section.title} - No content found`);
                continue;
            }

            // Create main section chunk
            const mainChunk = {
                id: section.id,
                title: section.title,
                type: section.type || category,
                category: category,
                content: content,
                tokens: estimateTokens(content),
                items: section.items.map(i => i.title)
            };

            // Build markdown
            let md = `# ${section.title}\n\n`;
            md += `**Type:** ${category}\n`;
            md += `**ID:** \`${section.id}\`\n\n`;

            if (section.items.length > 0) {
                md += `## Members\n\n`;
                section.items.forEach(item => {
                    md += `- ${item.title} ${item.type === 'method' ? '(method)' : '(property)'}\n`;
                });
                md += '\n';
            }

            md += `## Description\n\n${content}\n\n`;

            // Process nested items
            for (const item of section.items) {
                const itemContent = extractSectionContent(html, item.id);
                if (itemContent) {
                    // Create chunk for nested item
                    const itemChunk = {
                        id: item.id,
                        title: item.title,
                        parent: section.id,
                        parentTitle: section.title,
                        type: item.type,
                        category: category,
                        content: itemContent,
                        tokens: estimateTokens(itemContent)
                    };

                    allChunks.push(itemChunk);

                    md += `### ${item.title}\n\n${itemContent}\n\n`;
                }
            }

            allChunks.push(mainChunk);
            markdown.push(md);

            console.log(`✓ ${section.title} (${category}) - ${mainChunk.tokens} tokens, ${section.items.length} items`);
        }

        // Save outputs
        console.log('\n==================================================');
        console.log('Saving outputs...\n');

        // 1. JSONL format for RAG (one chunk per line)
        const jsonlPath = path.join(OUTPUT_DIR, 'docs-chunks.jsonl');
        const jsonlContent = allChunks.map(chunk => JSON.stringify(chunk)).join('\n');
        fs.writeFileSync(jsonlPath, jsonlContent, 'utf8');
        console.log(`✓ JSONL chunks: ${allChunks.length} chunks`);

        // 2. JSON format (full structure)
        const jsonPath = path.join(OUTPUT_DIR, 'docs-structured.json');
        fs.writeFileSync(jsonPath, JSON.stringify(allChunks, null, 2), 'utf8');
        console.log(`✓ JSON structured data`);

        // 3. Combined markdown (for direct context use)
        const mdPath = path.join(OUTPUT_DIR, 'docs-complete.md');
        const fullMarkdown = '# Screeps Arena API Documentation\n\n' +
            `**Generated:** ${new Date().toISOString()}\n\n` +
            '---\n\n' +
            markdown.join('\n---\n\n');
        fs.writeFileSync(mdPath, fullMarkdown, 'utf8');
        console.log(`✓ Complete markdown document`);

        // 4. Save original HTML
        const htmlPath = path.join(OUTPUT_DIR, 'docs-original.html');
        fs.writeFileSync(htmlPath, html, 'utf8');
        console.log(`✓ Original HTML`);

        // 5. Create index with statistics
        const stats = {
            totalChunks: allChunks.length,
            totalSections: sections.length,
            categories: {},
            totalTokens: 0,
            avgTokensPerChunk: 0
        };

        allChunks.forEach(chunk => {
            stats.categories[chunk.category] = (stats.categories[chunk.category] || 0) + 1;
            stats.totalTokens += chunk.tokens;
        });

        stats.avgTokensPerChunk = Math.round(stats.totalTokens / allChunks.length);

        const readmePath = path.join(OUTPUT_DIR, 'README.md');
        let readme = `# Screeps Arena Documentation - LLM Optimized\n\n`;
        readme += `**Generated:** ${new Date().toISOString()}\n`;
        readme += `**Source:** ${BASE_URL}\n\n`;
        readme += `## Statistics\n\n`;
        readme += `- Total sections: ${stats.totalSections}\n`;
        readme += `- Total chunks: ${stats.totalChunks}\n`;
        readme += `- Total tokens (estimated): ${stats.totalTokens.toLocaleString()}\n`;
        readme += `- Average tokens per chunk: ${stats.avgTokensPerChunk}\n\n`;
        readme += `## Categories\n\n`;
        Object.entries(stats.categories).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
            readme += `- ${cat}: ${count}\n`;
        });
        readme += `\n## Files\n\n`;
        readme += `- \`docs-chunks.jsonl\` - JSONL format, one chunk per line (best for RAG)\n`;
        readme += `- \`docs-structured.json\` - Full JSON array with all chunks\n`;
        readme += `- \`docs-complete.md\` - Complete markdown (${stats.totalTokens} tokens, fits in Claude context)\n`;
        readme += `- \`docs-original.html\` - Original HTML source\n\n`;
        readme += `## Usage\n\n`;
        readme += `### For Direct LLM Context\n\n`;
        readme += `Use \`docs-complete.md\` - it's clean, well-structured markdown that fits in most LLM context windows.\n\n`;
        readme += `### For RAG Systems\n\n`;
        readme += `Use \`docs-chunks.jsonl\` where each line is a JSON object with:\n`;
        readme += `- \`id\`: Unique identifier\n`;
        readme += `- \`title\`: Section/item title\n`;
        readme += `- \`type\`: API type (property, method, etc.)\n`;
        readme += `- \`category\`: High-level category (class, function, constant, etc.)\n`;
        readme += `- \`content\`: Clean markdown content\n`;
        readme += `- \`tokens\`: Estimated token count\n`;
        readme += `- \`parent\`: Parent section (for nested items)\n\n`;
        readme += `### Chunk Characteristics\n\n`;
        readme += `- Average size: ~${stats.avgTokensPerChunk} tokens\n`;
        readme += `- Format: Clean markdown\n`;
        readme += `- Metadata: Rich typing and categorization\n`;
        readme += `- Self-contained: Each chunk includes necessary context\n`;

        fs.writeFileSync(readmePath, readme, 'utf8');
        console.log(`✓ README with statistics\n`);

        // Summary
        console.log('==================================================');
        console.log('✓ Documentation successfully processed!\n');
        console.log(`Output: ${OUTPUT_DIR}/`);
        console.log(`Total tokens: ${stats.totalTokens.toLocaleString()} (fits in Claude 200k context)`);
        console.log(`\nRecommendation: ${stats.totalTokens < 100000 ?
            'Use docs-complete.md for direct context' :
            'Use docs-chunks.jsonl with RAG'}\n`);

    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

// Run
scrape();
