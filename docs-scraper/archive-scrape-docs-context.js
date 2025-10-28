const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// Configuration
const BASE_URL = 'https://arena.screeps.com/docs/';
const OUTPUT_DIR = '../screeps-docs-context';

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

// Estimate tokens (1 token ≈ 4 characters for estimation)
function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}

// Decode all HTML entities
function decodeHtml(html) {
    let text = html;

    // Common HTML entities
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    text = text.replace(/&#x27;/g, "'");
    text = text.replace(/&apos;/g, "'");
    text = text.replace(/&mdash;/g, '—');
    text = text.replace(/&ndash;/g, '–');
    text = text.replace(/&hellip;/g, '...');

    return text;
}

// Extract navigation structure
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

// Extract and clean content for a section
function extractCleanContent(html, sectionId) {
    const sectionRegex = new RegExp(`<[^>]*\\sid="${sectionId}"[^>]*>([\\s\\S]*?)(?=<[^>]*\\sid="(?!${sectionId}\\.)"|$)`, 'i');
    const match = html.match(sectionRegex);

    if (!match) return null;

    let content = match[1];

    // Remove script and style tags
    content = content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    content = content.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

    // Extract code blocks first to protect them
    const codeBlocks = [];
    content = content.replace(/<pre[^>]*><code[^>]*>(.*?)<\/code><\/pre>/gis, (match, code) => {
        const placeholder = `__CODEBLOCK_${codeBlocks.length}__`;
        codeBlocks.push(decodeHtml(code.trim()));
        return placeholder;
    });

    // Extract inline code
    const inlineCodes = [];
    content = content.replace(/<code[^>]*>(.*?)<\/code>/gi, (match, code) => {
        const placeholder = `__INLINECODE_${inlineCodes.length}__`;
        inlineCodes.push(decodeHtml(code));
        return placeholder;
    });

    // Convert HTML to markdown
    content = content.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n# $1\n');
    content = content.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n');
    content = content.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n');
    content = content.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '\n#### $1\n');
    content = content.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
    content = content.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
    content = content.replace(/<br\s*\/?>/gi, '\n');

    // Handle tables - convert to markdown tables
    content = content.replace(/<table[^>]*>(.*?)<\/table>/gis, (match, tableContent) => {
        let markdown = '\n\n';

        // Extract headers
        const headerMatch = tableContent.match(/<thead[^>]*>(.*?)<\/thead>/is);
        if (headerMatch) {
            const headers = [];
            const headerRegex = /<th[^>]*>(.*?)<\/th>/gi;
            let headerCell;
            while ((headerCell = headerRegex.exec(headerMatch[1])) !== null) {
                headers.push(headerCell[1].replace(/<[^>]+>/g, '').trim());
            }

            if (headers.length > 0) {
                markdown += '| ' + headers.join(' | ') + ' |\n';
                markdown += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
            }
        }

        // Extract rows
        const rowRegex = /<tr[^>]*>(.*?)<\/tr>/gis;
        let rowMatch;
        while ((rowMatch = rowRegex.exec(tableContent)) !== null) {
            const row = rowMatch[1];
            if (row.includes('<th')) continue; // Skip header rows

            const cells = [];
            const cellRegex = /<td[^>]*>(.*?)<\/td>/gi;
            let cellMatch;
            while ((cellMatch = cellRegex.exec(row)) !== null) {
                cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
            }

            if (cells.length > 0) {
                markdown += '| ' + cells.join(' | ') + ' |\n';
            }
        }

        return markdown + '\n';
    });

    // Handle lists
    content = content.replace(/<ul[^>]*>(.*?)<\/ul>/gis, (match, list) => {
        let markdown = '\n';
        const itemRegex = /<li[^>]*>(.*?)<\/li>/gi;
        let itemMatch;
        while ((itemMatch = itemRegex.exec(list)) !== null) {
            const item = itemMatch[1].replace(/<[^>]+>/g, '').trim();
            markdown += `- ${item}\n`;
        }
        return markdown + '\n';
    });

    // Remove remaining HTML tags
    content = content.replace(/<[^>]+>/g, '');

    // Decode HTML entities
    content = decodeHtml(content);

    // Restore code blocks
    codeBlocks.forEach((code, i) => {
        content = content.replace(`__CODEBLOCK_${i}__`, `\n\`\`\`javascript\n${code}\n\`\`\`\n`);
    });

    // Restore inline code
    inlineCodes.forEach((code, i) => {
        content = content.replace(`__INLINECODE_${i}__`, `\`${code}\``);
    });

    // Clean up excessive whitespace
    content = content.replace(/\n{4,}/g, '\n\n');
    content = content.replace(/[ \t]+/g, ' ');
    content = content.trim();

    return content;
}

// Categorize section
function categorizeSection(section) {
    const title = section.title;
    const id = section.id.toLowerCase();

    if (title.startsWith('Structure')) return 'Structure';
    if (title === 'GameObject' || title === 'ConstructionSite' || title === 'Resource' || title === 'Source') return 'Game Object';
    if (title === 'Creep') return 'Creep';
    if (title === 'Store' || title === 'CostMatrix' || title === 'Visual' || title === 'Spawning') return 'Utility';
    if (id.includes('effect_') || id.includes('resource_')) return 'Constant';
    if (section.items.length === 0 && /^[a-z]/.test(title)) return 'Function';
    if (title.includes('info')) return 'Global';

    return 'Object';
}

// Create directory
function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

// Main scraper
async function scrape() {
    console.log('Screeps Arena Documentation Scraper');
    console.log('Optimized for Direct LLM Context');
    console.log('=====================================\n');

    try {
        console.log('Fetching documentation...');
        const html = await fetch(BASE_URL);

        ensureDir(OUTPUT_DIR);

        console.log('Parsing structure...');
        const sections = parseNavigation(html);
        console.log(`Found ${sections.length} sections\n`);

        // Group sections by category
        const categorized = {};
        sections.forEach(section => {
            const category = categorizeSection(section);
            if (!categorized[category]) categorized[category] = [];
            categorized[category].push(section);
        });

        // Build comprehensive markdown document
        let markdown = '';

        // Header
        markdown += '# Screeps Arena API Documentation\n\n';
        markdown += `**Generated:** ${new Date().toISOString()}\n`;
        markdown += `**Source:** ${BASE_URL}\n\n`;
        markdown += '> This documentation is optimized for LLM consumption. All content is structured in clean markdown format.\n\n';

        // Table of contents
        markdown += '## Table of Contents\n\n';
        const categoryOrder = ['Global', 'Game Object', 'Creep', 'Structure', 'Utility', 'Function', 'Constant', 'Object'];
        categoryOrder.forEach(category => {
            if (categorized[category]) {
                markdown += `### ${category}\n\n`;
                categorized[category].forEach(section => {
                    markdown += `- [${section.title}](#${section.id.toLowerCase()})\n`;
                });
                markdown += '\n';
            }
        });

        markdown += '---\n\n';

        // Process each category
        console.log('Processing sections:\n');
        let totalTokens = 0;

        categoryOrder.forEach(category => {
            if (!categorized[category]) return;

            markdown += `# ${category}\n\n`;

            categorized[category].forEach(section => {
                const content = extractCleanContent(html, section.id);

                if (!content) {
                    console.log(`⚠ ${section.title} - No content`);
                    return;
                }

                // Section header
                markdown += `## ${section.title}\n\n`;
                markdown += `**ID:** \`${section.id}\`\n\n`;

                if (section.items.length > 0) {
                    markdown += '**Members:**\n\n';
                    section.items.forEach(item => {
                        const itemType = item.type === 'method' ? '()' : '';
                        markdown += `- \`${item.title}${itemType}\` - ${item.type}\n`;
                    });
                    markdown += '\n';
                }

                // Main content
                markdown += content + '\n\n';

                // Process nested items
                section.items.forEach(item => {
                    const itemContent = extractCleanContent(html, item.id);
                    if (itemContent) {
                        markdown += `### ${section.title}.${item.title}\n\n`;
                        markdown += `**Type:** ${item.type}\n\n`;
                        markdown += itemContent + '\n\n';
                    }
                });

                markdown += '---\n\n';

                const tokens = estimateTokens(content);
                totalTokens += tokens;
                console.log(`✓ ${section.title} (${category}) - ${section.items.length} members`);
            });
        });

        // Save markdown
        const mdPath = path.join(OUTPUT_DIR, 'screeps-arena-docs.md');
        fs.writeFileSync(mdPath, markdown, 'utf8');

        // Save original HTML for reference
        const htmlPath = path.join(OUTPUT_DIR, 'original.html');
        fs.writeFileSync(htmlPath, html, 'utf8');

        // Create README with usage instructions
        const readmePath = path.join(OUTPUT_DIR, 'README.md');
        const totalEstimatedTokens = estimateTokens(markdown);

        let readme = '# Screeps Arena Documentation for LLM Context\n\n';
        readme += `**Generated:** ${new Date().toISOString()}\n\n`;
        readme += '## Files\n\n';
        readme += `- \`screeps-arena-docs.md\` - Complete API documentation (${totalEstimatedTokens.toLocaleString()} tokens)\n`;
        readme += `- \`original.html\` - Original HTML source\n\n`;
        readme += '## Statistics\n\n';
        readme += `- **Total sections:** ${sections.length}\n`;
        readme += `- **Estimated tokens:** ${totalEstimatedTokens.toLocaleString()}\n`;
        readme += `- **Format:** Clean markdown with proper hierarchy\n\n`;
        readme += '## Usage\n\n';
        readme += '### Direct Context\n\n';
        readme += 'Use `screeps-arena-docs.md` directly in your LLM context. The documentation is:\n\n';
        readme += '- **Clean markdown** - Properly formatted with code blocks and tables\n';
        readme += '- **Well-structured** - Organized by category with clear hierarchy\n';
        readme += '- **Self-contained** - All information in one file\n';
        readme += '- **Context-optimized** - Fits in most modern LLM context windows\n\n';
        readme += '### Example\n\n';
        readme += '```\n';
        readme += 'claude --context screeps-arena-docs.md "How do I make a creep harvest energy?"\n';
        readme += '```\n\n';
        readme += '## Categories\n\n';

        Object.entries(categorized).forEach(([cat, items]) => {
            readme += `- **${cat}:** ${items.length} items\n`;
        });

        fs.writeFileSync(readmePath, readme, 'utf8');

        // Summary
        console.log('\n=====================================');
        console.log('✓ Documentation generated!\n');
        console.log(`Output: ${OUTPUT_DIR}/screeps-arena-docs.md`);
        console.log(`Size: ${totalEstimatedTokens.toLocaleString()} tokens (fits in Claude 200k context)\n`);

        // Context window recommendations
        if (totalEstimatedTokens < 50000) {
            console.log('✓ Fits easily in most LLM contexts (GPT-4, Claude, etc.)');
        } else if (totalEstimatedTokens < 100000) {
            console.log('✓ Fits in large LLM contexts (Claude 2+, GPT-4 Turbo)');
        } else {
            console.log('✓ Fits in extended context models (Claude 200k)');
        }

        console.log('\nRecommended usage:');
        console.log('  Load screeps-arena-docs.md into your LLM context for complete API reference\n');

    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

scrape();
