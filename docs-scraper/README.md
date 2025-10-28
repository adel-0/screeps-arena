# Screeps Arena Documentation Scraper

Downloads complete Screeps Arena API documentation optimized for direct LLM context use.

## Usage

From the `docs-scraper` directory:

```bash
node scrape.js
```

Or using npm:

```bash
npm run scrape
```

## Output

Creates `../screeps-arena-docs.md` containing:

- Complete API documentation (~3,400 tokens)
- All 47 API sections (objects, structures, utilities, functions, constants)
- Clean markdown format with code examples
- Optimized for LLM context windows

## Features

- Downloads all documentation content
- Organized by API sections (Objects, Functions, Constants)
- Multiple output formats (HTML, text, markdown)
- No external dependencies (uses built-in Node.js modules only)
- Structured navigation with table of contents
- Each section saved as individual markdown file

## Requirements

- Node.js (v12 or higher)
- Internet connection
- No npm packages required

## Example Output Structure

```
ScreepsArena/
├── docs-scraper/            # This folder
│   ├── scrape-docs-structured.js
│   ├── package.json
│   └── README.md
└── screeps-docs-structured/ # Generated documentation
    ├── full-docs.html       # Complete original HTML
    ├── full-docs.txt        # Plain text version
    ├── navigation.json      # Structure metadata
    ├── README.md            # Index page
    └── sections/            # Individual API sections
        ├── creep/
        │   └── README.md    # Creep API (20 methods)
        ├── gameobject/
        │   └── README.md    # GameObject API (10 methods)
        ├── structurespawn/
        │   └── README.md    # StructureSpawn API (5 methods)
        └── ... (44 more sections)
```

## Documentation Coverage

The scraper captures all 47 main API sections including:
- Core objects (GameObject, Creep, Structure, etc.)
- Structures (Spawn, Tower, Container, etc.)
- Utilities (Store, CostMatrix, Visual, etc.)
- Global functions (findPath, getObjectById, etc.)
- Arena-specific features (AreaEffect, ScoreCollector, etc.)
- Constants (EFFECT_*, RESOURCE_*, etc.)

## Notes

- The Screeps Arena documentation is a single-page application
- All content is available in one HTML file
- The structured scraper organizes it into readable sections
- No server requests are repeated (single download)
- Content extraction preserves code examples and structure
