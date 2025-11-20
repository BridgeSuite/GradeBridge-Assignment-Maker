# GradeBridge Lite Assigmnent Maker

A professional, client-side assignment creation tool for educators.

## Features
- Create structured assignments with multiple problem types
- Generate JSON specifications for student apps
- Export PDF templates for Gradescope
- 100% Client-side (Local Storage)
- No server required

## How to Run Locally

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
- React + TypeScript
- Vite
- Tailwind CSS
- jsPDF / JSZip
