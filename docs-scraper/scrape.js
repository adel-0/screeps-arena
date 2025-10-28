const https = require('https');
const fs = require('fs');

const BASE_URL = 'https://arena.screeps.com/docs/';
const OUTPUT_FILE = '../screeps-arena-docs.md';

function fetch(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
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

function clean(text) {
    return text
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

function parseNav(html) {
    const sections = [];
    const navRegex = /<div class="nav-root[^"]*"[^>]*><a href="#([^"]+)">([^<]+)<\/a>([\s\S]*?)(?=<div class="nav-root|<\/nav>)/g;
    let match;

    while ((match = navRegex.exec(html)) !== null) {
        const [, id, title, content] = match;
        const items = [];
        const itemRegex = /<a href="#([^"]+)">([^<]+)<\/a>/g;
        let itemMatch;

        while ((itemMatch = itemRegex.exec(content)) !== null) {
            items.push({ id: itemMatch[1], name: itemMatch[2] });
        }

        sections.push({ id, title, items });
    }

    return sections;
}

function extract(html, id) {
    const match = html.match(new RegExp(`<div[^>]*id="${id}"[^>]*>([\\s\\S]{0,5000}?)<\/div>`, 'i'));
    if (!match) return '';

    let text = match[1];

    // Preserve code blocks
    const codes = [];
    text = text.replace(/<pre[^>]*><code[^>]*>(.*?)<\/code><\/pre>/gs, (_, code) => {
        codes.push(clean(code));
        return `___CODE${codes.length - 1}___`;
    });

    // Preserve inline code
    const inlines = [];
    text = text.replace(/<code[^>]*>(.*?)<\/code>/g, (_, code) => {
        inlines.push(clean(code));
        return `___INLINE${inlines.length - 1}___`;
    });

    // Remove tags
    text = text.replace(/<[^>]+>/g, ' ');
    text = clean(text);

    // Restore code
    codes.forEach((code, i) => {
        text = text.replace(`___CODE${i}___`, `\n\`\`\`javascript\n${code}\n\`\`\`\n`);
    });
    inlines.forEach((code, i) => {
        text = text.replace(`___INLINE${i}___`, `\`${code}\``);
    });

    return text;
}

async function main() {
    console.log('Screeps Arena Documentation Scraper\n');

    try {
        console.log('Fetching...');
        const html = await fetch(BASE_URL);

        console.log('Parsing...');
        const sections = parseNav(html);
        console.log(`Found ${sections.length} sections\n`);

        let md = '# Screeps Arena API Reference\n\n';
        md += `> **Source:** ${BASE_URL}  \n`;
        md += `> **Generated:** ${new Date().toISOString()}\n\n`;
        md += `This documentation covers ${sections.length} API sections including game objects, structures, utilities, and constants.\n\n`;
        md += '---\n\n';

        console.log('Extracting:\n');

        for (const section of sections) {
            const content = extract(html, section.id);

            md += `## ${section.title}\n\n`;

            if (content) {
                md += `${content}\n\n`;
            }

            if (section.items.length > 0) {
                md += `### Members\n\n`;

                for (const item of section.items) {
                    const itemContent = extract(html, item.id);
                    md += `#### ${item.name}\n\n`;

                    if (itemContent) {
                        md += `${itemContent}\n\n`;
                    }
                }
            }

            md += '---\n\n';

            console.log(`✓ ${section.title} (${section.items.length} members)`);
        }

        fs.writeFileSync(OUTPUT_FILE, md, 'utf8');

        const sizeKB = Math.ceil(md.length / 1024);
        const tokens = Math.ceil(md.length / 4);

        console.log('\n====================================');
        console.log(`✓ Complete!`);
        console.log(`\n   File: ${OUTPUT_FILE}`);
        console.log(`   Size: ${sizeKB} KB`);
        console.log(`  Tokens: ~${tokens.toLocaleString()}`);
        console.log(`\nReady for LLM context!\n`);

    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

main();
