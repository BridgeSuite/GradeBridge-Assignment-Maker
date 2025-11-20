# GradeBridge Assignment Maker

A professional, client-side assignment creation tool for educators. Built with BridgeSuite branding.

## Features

### Core Functionality
- **Structured Assignment Creation** - Create assignments with multiple problems and subsections
- **Multiple Submission Types** - Support for Text, Image, Code, and File uploads
- **LaTeX Support** - Live preview of mathematical notation using KaTeX
- **Generate JSON Specifications** - Export assignment specs for student submission apps
- **Export to PDF** - Generate PDF templates for Gradescope integration
- **Export to ZIP** - Download complete assignment packages

### Enhanced Features
- **LaTeX Preview** - Real-time rendering of inline `$...$` and block `$$...$$` LaTeX equations
- **Load Template** - Import existing assignment JSON files to use as templates
- **Duplicate Assignments** - Copy and modify existing assignments with one click
- **Privacy Notice** - Built-in privacy modal explaining 100% local execution
- **BridgeSuite Branding** - Professional branding with logo integration

### Privacy & Data
- **100% Client-Side Execution** - All data stays in your browser
- **Local Storage** - Assignments saved to browser storage
- **No Server Required** - Complete privacy and data control
- **Export for Backup** - Regular exports recommended

## Getting Started

### Try the Example Assignment

An example assignment is included in the `example_assignment/` folder:
- **File**: `example_spec.json`
- **Content**: Engineering lab report assignment with LaTeX, text fields, and image uploads
- **How to Use**:
  1. Open the Assignment Manager
  2. Click "Load Template" when creating a new assignment
  3. Select `example_assignment/example_spec.json`
  4. Edit and customize as needed

### Run Locally

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Start Development Server**
   ```bash
   npm run dev
   ```
   Open http://localhost:3000 in your browser.

3. **Build for Production**
   ```bash
   npm run build
   ```
   This will create a `dist` folder with static files you can host anywhere.

## Tech Stack
- **React 19** + TypeScript
- **Vite 5.4** - Fast build tool
- **Tailwind CSS** - Utility-first styling
- **KaTeX** - LaTeX math rendering
- **jsPDF** - PDF generation
- **JSZip** - ZIP archive creation
- **Lucide React** - Icon library

## License
MIT License - Free for personal and commercial use. See [LICENSE](LICENSE) file for details.

## Credits
Provided free of charge by **BridgeSuite**
