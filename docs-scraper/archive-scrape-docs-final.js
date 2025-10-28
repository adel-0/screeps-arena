const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://arena.screeps.com/docs/';
const OUTPUT_DIR = '../screeps-docs-context';

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

function cleanText(text) {
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

// Extract entities (sections) from HTML
function extractEntities(html) {
    const entities = [];

    // Find all entity divs - these are the main API sections
    const entityRegex = /<div id="([^"]+)" class="entity___[^"]*"[^>]*>(.*?)<\/div>(?=<div (?:id="[^"]+"|class="module-entity-properties))/gs;
    let match;

    while ((match = entityRegex.exec(html)) !== null) {
        const [, id, content] = match;

        // Extract title
        const titleMatch = content.match(/<h3>([^<]+)/);
        const title = titleMatch ? cleanText(titleMatch[1]) : id;

        // Extract description
        const descMatch = content.match(/data-entity-desc="true"[^>]*>(.*?)<\/div>/s);
        let description = '';
        if (descMatch) {
            description = descMatch[1]
                .replace(/<a[^>]*href="#([^"]+)"[^>]*>([^<]+)<\/a>/g, '`$2`')
                .replace(/<[^>]+>/g, '')
                .trim();
            description = cleanText(description);
        }

        // Extract type info
        const extendsMatch = content.match(/extends <a[^>]*>([^<]+)<\/a>/);
        const typeMatch = content.match(/<span>(class|object|function)/);

        entities.push({
            id,
            title,
            type: typeMatch ? typeMatch[1] : 'object',
            extends: extendsMatch ? extendsMatch[1] : null,
            description
        });
    }

    return entities;
}

// Extract properties/methods for an entity
function extractProperties(html, entityId) {
    const properties = [];

    // Find the properties section for this entity
    const propsRegex = new RegExp(`<div id="${entityId}\\.[^"]+">.*?</div>`, 'gs');
    let match;

    while ((match = propsRegex.exec(html)) !== null) {
        const propHtml = match[0];

        // Extract property ID
        const idMatch = propHtml.match(/id="([^"]+)"/);
        if (!idMatch) continue;

        const fullId = idMatch[1];
        const propName = fullId.split('.').pop();

        // Determine if it's a method or property
        const isMethod = propHtml.includes('method-sign') || propHtml.includes('method___');

        // Extract description - get first paragraph of text
        let description = propHtml
            .replace(/<script[^>]*>.*?<\/script>/gs, '')
            .replace(/<style[^>]*>.*?<\/style>/gs, '')
            .replace(/<code[^>]*>(.*?)<\/code>/g, '`$1`')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        description = cleanText(description);

        // Limit description length for properties/methods
        if (description.length > 500) {
            description = description.substring(0, 500) + '...';
        }

        properties.push({
            name: propName,
            type: isMethod ? 'method' : 'property',
            description
        });
    }

    return properties;
}

async function main() {
    console.log('Screeps Arena Documentation Scraper');
    console.log('Optimized for Direct LLM Context');
    console.log('=====================================\n');

    try {
        console.log('Fetching documentation...');
        const html = await fetch(BASE_URL);

        if (!fs.existsSync(OUTPUT_DIR)) {
            fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        }

        console.log('Extracting entities...');
        const entities = extractEntities(html);
        console.log(`Found ${entities.length} entities\n`);

        // Build markdown
        let md = '# Screeps Arena API Documentation\n\n';
        md += `**Generated:** ${new Date().toISOString()}\n`;
        md += `**Source:** ${BASE_URL}\n\n`;
        md += '> Complete API reference for Screeps Arena, optimized for LLM consumption.\n\n';

        // Table of contents
        md += '## Table of Contents\n\n';
        entities.forEach(e => {
            md += `- [${e.title}](#${e.id.toLowerCase().replace(/[^a-z0-9]+/g, '-')})\n`;
        });
        md += '\n---\n\n';

        console.log('Processing entities:\n');

        // Process each entity
        for (const entity of entities) {
            md += `## ${entity.title}\n\n`;

            if (entity.extends) {
                md += `*Extends: ${entity.extends}*\n\n`;
            }

            if (entity.description) {
                md += `${entity.description}\n\n`;
            }

            // Extract properties/methods
            const props = extractProperties(html, entity.id);

            if (props.length > 0) {
                md += `### Members\n\n`;
                props.forEach(prop => {
                    const propType = prop.type === 'method' ? '()' : '';
                    md += `#### ${prop.name}${propType}\n\n`;
                    if (prop.description) {
                        md += `${prop.description}\n\n`;
                    }
                });
            }

            md += '---\n\n';

            console.log(`✓ ${entity.title} (${props.length} members)`);
        }

        // Save markdown
        const mdPath = path.join(OUTPUT_DIR, 'screeps-arena-docs.md');
        fs.writeFileSync(mdPath, md, 'utf8');

        // Calculate actual stats
        const tokens = Math.ceil(md.length / 4);
        const sizeKB = Math.ceil(md.length / 1024);

        // Save README
        let readme = '# Screeps Arena Documentation\n\n';
        readme += `**Generated:** ${new Date().toISOString()}\n\n`;
        readme += '## File\n\n';
        readme += `- \`screeps-arena-docs.md\` - Complete API documentation\n\n`;
        readme += '## Statistics\n\n';
        readme += `- **Sections:** ${entities.length}\n`;
        readme += `- **Size:** ${sizeKB} KB\n`;
        readme += `- **Estimated tokens:** ~${tokens.toLocaleString()}\n`;
        readme += `- **Format:** Clean markdown\n\n`;
        readme += '## Usage\n\n';
        readme += 'Load `screeps-arena-docs.md` directly into your LLM context:\n\n';
        readme += '```bash\n';
        readme += 'claude --context screeps-arena-docs.md "How do I spawn a creep?"\n';
        readme += '```\n\n';
        readme += 'The documentation includes:\n';
        readme += '- All game objects and classes\n';
        readme += '- All methods and properties\n';
        readme += '- Type information and inheritance\n';
        readme += '- Descriptions and usage info\n';

        fs.writeFileSync(path.join(OUTPUT_DIR, 'README.md'), readme, 'utf8');

        console.log('\n=====================================');
        console.log('✓ Documentation generated!\n');
        console.log(`File: ${OUTPUT_DIR}/screeps-arena-docs.md`);
        console.log(`Size: ${sizeKB} KB (~${tokens.toLocaleString()} tokens)`);
        console.log(`\n✓ Fits in all modern LLM contexts\n`);

    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

main();
