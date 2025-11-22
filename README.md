# GradeBridge Assignment Maker

A professional, client-side assignment creation tool for educators to create structured assignments with LaTeX support, multiple submission types, and Gradescope integration.

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

**🚀 [Live Demo](https://bridgesuite.github.io/GradeBridge-Assignment-Maker/)** - Try the app now!


## The Problem This Solves

**Traditional assignment creation:** 3+ hours of fighting with Word formatting, equation editors, and inconsistent student submissions.

**GradeBridge workflow:** 15 minutes to create professional assignments that auto-generate perfectly formatted student submissions.

This is **Part 1** of the complete GradeBridge workflow:
1. **Assignment Maker** (this app) - Create structured assignments with LaTeX support
2. **[Student Submission](https://github.com/BridgeSuite/GradeBridge-Student-Submission)** - Students complete work and generate grading-ready PDFs

📖 **[See the complete workflow explanation →](https://github.com/BridgeSuite/.github/blob/main/profile/WORKFLOW_MOTIVATION.md)**

---
## Overview

**GradeBridge Assignment Maker** is a React-based web application that enables instructors to create professional assignments with structured problems, subsections, and multiple submission types. 

100% Local: All processing happens entirely in your browser. No server is required, and no student data is ever transmitted over the internet.

Open Source: This is a free, community-supported tool maintained by the BridgeSuite Open Source Project.

**GradeBridge Assignment Maker** is a React-based web application that enables instructors to create professional assignments with structured problems, subsections, and multiple submission types. All processing happens **entirely in the browser** - no server required, no data transmitted anywhere.

### Key Features

- **100% Client-Side Processing**: All work is stored locally in your browser
- **Structured Assignment Creation**: Create assignments with multiple problems and subsections
- **LaTeX Math Support**: Write mathematical expressions with live preview using KaTeX
- **Multiple Submission Types**: Support for text, image, and AI reflective answers
- **Professional PDF Generation**: Export Gradescope-compatible template PDFs
- **JSON Export**: Generate assignment specifications for the Student Submission app
- **ZIP Package Export**: Download complete assignment packages
- **Load Templates**: Import and modify existing assignment JSON files
- **Privacy-First**: Explicit privacy notice on first use
- **BridgeSuite Branding**: Professional branding with logo integration

## Technology Stack

- **React 18.2** - UI framework
- **TypeScript** - Type safety
- **Vite 5.4** - Build tool and dev server
- **Tailwind CSS** - Utility-first styling
- **KaTeX** - LaTeX math rendering
- **jsPDF** - PDF generation
- **JSZip** - ZIP archive creation
- **Lucide React** - Icon library
- **React Router** - Navigation

## Installation & Setup

### Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn

### Local Development

1. **Clone the repository**:
   ```bash
   git clone https://github.com/BridgeSuite/GradeBridge-Assignment-Maker.git
   cd GradeBridge-Assignment-Maker
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Run the development server**:
   ```bash
   npm run dev
   ```

4. **Open in browser**:
   - Navigate to `http://localhost:3000`

### Build for Production

```bash
npm run build
```

The built files will be in the `dist` directory, ready to deploy to any static hosting service.

### Deploy to GitHub Pages

```bash
npm run deploy
```

This will automatically build and deploy the app to GitHub Pages.

## Usage Guide

### 1. First Time Setup

When you first open GradeBridge Assignment Maker, you'll see a **privacy notice** explaining that all data is stored locally in your browser. Click "I Understand" to proceed.

### 2. Create a New Assignment

1. Click **"Create New Assignment"**
2. Enter assignment details:
   - **Assignment Title**: Name of the assignment
   - **Course Code**: e.g., "ECE416"
   - **Course Name** (optional): Full course name
   - **Preamble** (optional): General instructions for students
   - **Total Points**: Sum of all problem points

### 3. Add Problems

For each problem:

1. Click **"Add Problem"**
2. Enter:
   - **Problem Statement**: Main question/task description
   - **Points**: Point value for this problem
   - **Problem Image** (optional): Upload a diagram, circuit, or reference image

3. **Choose submission structure**:
   - **Direct Submission**: Students submit at the problem level
   - **Subsections**: Break the problem into parts (a, b, c, etc.)

### 4. Configure Subsections (if applicable)

For each subsection:

1. Enter:
   - **Subsection Statement**: The specific question/task
   - **Points**: Point value for this subsection

2. **Select Submission Types** (can select multiple):
   - ✅ **Answer as text**: Text/LaTeX input field
   - ✅ **Answer as image**: Image upload (specify max images allowed)
   - ✅ **AI Reflective**: AI tool usage documentation

3. **For image submissions**:
   - Set **Max Images Allowed** (e.g., 1, 2, 3)
   - Each image gets a dedicated page in the PDF

### 5. LaTeX Support

Use LaTeX for mathematical notation:

- **Inline math**: `$x^2 + y^2 = z^2$`
- **Display math**: `$$\int_0^\infty e^{-x^2} dx$$`

The preview updates in real-time as you type!

### 6. Export Your Assignment

#### Export JSON (for Students)
1. Click **"Export JSON"**
2. Share this file with students
3. Students load it in the **GradeBridge Student Submission** app

#### Export PDF (for Gradescope)
1. Click **"Export PDF"**
2. Upload to Gradescope as the template
3. Gradescope uses this to set grading regions

#### Export ZIP (Complete Package)
1. Click **"Export ZIP"**
2. Contains both JSON and PDF files
3. Useful for archiving or sharing complete assignments

### 7. Load an Existing Assignment

1. Click **"Load Template"**
2. Select a previously exported JSON file
3. Edit and modify as needed
4. Save as a new assignment

## Assignment JSON Format

The exported JSON follows this structure:

```json
{
  "assignment_title": "Mini-Project 1",
  "course_code": "ECE416",
  "course_name": "Digital Control Systems",
  "preamble": "Complete all problems showing your work...",
  "total_points": 50,
  "problems": [
    {
      "problem_statement": "Analyze the following system using state-space methods.",
      "points": 20,
      "problem_image": {
        "data": "base64_encoded_image_data",
        "content_type": "image/png",
        "filename": "system_diagram.png"
      },
      "subsections": [
        {
          "subsection_statement": "Derive the state-space representation",
          "points": 10,
          "submission_elements": ["Answer as text"],
          "max_images_allowed": 0
        },
        {
          "subsection_statement": "Plot the step response",
          "points": 10,
          "submission_elements": ["Answer as image"],
          "max_images_allowed": 2
        }
      ]
    }
  ]
}
```

### JSON Field Descriptions

**Assignment Level:**
- `assignment_title`: Name displayed to students
- `course_code`: Short course identifier (e.g., "ECE416")
- `course_name`: Full course name (optional)
- `preamble`: General instructions shown at the top
- `total_points`: Sum of all problem points
- `problems`: Array of problem objects

**Problem Level:**
- `problem_statement`: Main question text (supports LaTeX)
- `points`: Point value for entire problem
- `problem_image`: Base64-encoded image with metadata (optional)
- `submission_elements`: For direct submission (optional)
- `subsections`: Array of subsection objects (optional)

**Subsection Level:**
- `subsection_statement`: Specific question for this part
- `points`: Point value for this subsection
- `submission_elements`: Array of allowed answer types
- `max_images_allowed`: Maximum images (for image submissions)

**Submission Element Types:**
- `"Answer as text"`: Text input with LaTeX support
- `"Answer as image"`: Image upload
- `"AI Reflective"`: AI tool usage documentation

## Example Assignment

An example assignment is included in `example_assignment/example_spec.json`:

**Content**: Engineering lab report with:
- LaTeX mathematical expressions
- Text answer fields
- Image upload requirements
- Multiple subsections

**To use**:
1. Open the Assignment Maker
2. Click "Load Template"
3. Select `example_assignment/example_spec.json`
4. Customize for your needs

## Data Storage & Privacy

### What Gets Stored

GradeBridge Assignment Maker stores data in **browser localStorage**:

- **Key**: `gradebridge_assignments`
- **Contains**: All created assignments
- **Size**: Typically 1-10 MB (varies with images)

### Privacy Guarantees

✅ **No server communication** - everything runs in your browser
✅ **No analytics or tracking**
✅ **No account required**
✅ **Data never leaves your computer** (unless you export)

### Data Persistence

- Data survives browser restarts
- Data survives computer restarts
- Data is **lost** if you:
  - Clear browser cache/localStorage
  - Use incognito/private mode
  - Switch browsers or computers

**Always export assignments as JSON backups!**

## Integration with Student Submission App

### Workflow

1. **Create Assignment** (Assignment Maker)
   - Design problems and subsections
   - Configure submission types
   - Export JSON and PDF

2. **Share with Students** (Assignment Maker → Students)
   - Provide the JSON file to students
   - Students use it in the **GradeBridge Student Submission** app

3. **Configure Gradescope** (Assignment Maker → Gradescope)
   - Upload the PDF template to Gradescope
   - Set grading regions (auto-detected if configured properly)

4. **Students Submit** (Student Submission App → Gradescope)
   - Students complete assignments in the submission app
   - Generate PDFs that match the template
   - Upload to Gradescope

### Companion App

**GradeBridge Student Submission**: https://bridgesuite.github.io/GradeBridge-Student-Submission/

Students use this app to:
- Load your assignment JSON
- Complete problems with text/images/AI reflections
- Generate properly formatted PDFs
- Submit to Gradescope

## Troubleshooting

### Assignment Won't Load

**Cause**: Invalid JSON format
**Solution**: Verify the JSON file is valid using a JSON validator. Ensure it was generated by Assignment Maker.

### LaTeX Not Rendering

**Cause**: KaTeX library failed to load
**Solution**: Check internet connection, refresh page. KaTeX loads from CDN.

### PDF Generation Fails

**Cause**: jsPDF library issue or memory limits
**Solution**:
- Reduce number of images
- Compress large images before adding
- Refresh the page and try again

### Lost Work After Closing Browser

**Cause**: Data was not saved or localStorage was cleared
**Solution**: Always export JSON backups regularly. Check browser settings for localStorage persistence.

### Images Not Appearing in PDF

**Cause**: Image file size too large or format unsupported
**Solution**:
- Use JPEG/PNG formats
- Compress images to under 2MB each
- Reduce image dimensions

## Development

### Code Style

- TypeScript with strict type checking
- Functional React components with hooks
- Tailwind CSS for styling
- ESLint/Prettier recommended

### Project Structure

```
gradebridge-lite-assignment-maker/
├── src/
│   ├── components/         # React components
│   ├── pages/             # Page-level components
│   ├── services/          # Business logic (PDF, export)
│   ├── types/             # TypeScript interfaces
│   └── App.tsx            # Main app component
├── public/
│   └── .nojekyll          # GitHub Pages configuration
├── example_assignment/
│   └── example_spec.json  # Example template
├── index.html             # HTML entry point
├── vite.config.ts         # Vite configuration
├── tailwind.config.js     # Tailwind configuration
└── package.json           # Dependencies
```

### Adding Features

1. Create feature branch: `git checkout -b feature/new-feature`
2. Implement changes
3. Test locally: `npm run dev`
4. Build: `npm run build`
5. Test build: `npm run preview`
6. Commit and push
7. Create pull request

### Key Dependencies

- **react** and **react-dom**: UI framework
- **jspdf**: PDF generation
- **jszip**: ZIP archive creation
- **file-saver**: File download utility
- **katex**: LaTeX rendering
- **lucide-react**: Icon library
- **react-router-dom**: Routing

## Browser Compatibility

Tested and working on:

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

**Not recommended**: Internet Explorer (not supported)

## Known Issues

1. **Large PDFs**: Assignments with many high-resolution images may take 10-20 seconds to generate
2. **Browser Memory**: Very large assignments (50+ problems) may hit browser memory limits
3. **Mobile Experience**: Optimized for desktop/laptop use; mobile is functional but not ideal

## Roadmap

Potential future enhancements:

- [ ] Drag-and-drop problem reordering
- [ ] Duplicate individual problems
- [ ] Import from other formats (Word, Markdown)
- [ ] Assignment templates library
- [ ] Collaboration features
- [ ] Version history

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes with clear commit messages
4. Ensure code compiles and runs
5. Submit a pull request

## License

MIT License - Free for personal and commercial use.

## Contact & Support

- **GitHub**: [BridgeSuite/GradeBridge-Assignment-Maker](https://github.com/BridgeSuite/GradeBridge-Assignment-Maker)
- **Issues**: [GitHub Issues](https://github.com/BridgeSuite/GradeBridge-Assignment-Maker/issues)
- **Live App**: [https://bridgesuite.github.io/GradeBridge-Assignment-Maker/](https://bridgesuite.github.io/GradeBridge-Assignment-Maker/)

## Related Projects

- **Student Submission App**: [GradeBridge-Student-Submission](https://github.com/BridgeSuite/GradeBridge-Student-Submission)
  - Companion app for students to complete assignments
  - Live: https://bridgesuite.github.io/GradeBridge-Student-Submission/

## Acknowledgments

- Built with React and TypeScript
- LaTeX rendering by [KaTeX](https://katex.org/)
- PDF generation by [jsPDF](https://github.com/parallax/jsPDF)
- ZIP creation by [JSZip](https://stuk.github.io/jszip/)
- Icons by [Lucide](https://lucide.dev/)
- Provided free of charge by **BridgeSuite**

---

**Version**: 1.0.0
**Last Updated**: November 2024
