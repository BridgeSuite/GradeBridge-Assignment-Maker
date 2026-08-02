# Contributing to GradeBridge Assignment Maker

Thank you for your interest in contributing to GradeBridge Assignment Maker! This tool helps educators create structured assignments with LaTeX support and Gradescope integration. We welcome contributions from educators, developers, and the academic community.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)
- [Contributing Code](#contributing-code)
- [Style Guidelines](#style-guidelines)
- [Testing Guidelines](#testing-guidelines)
- [Documentation](#documentation)
- [Questions?](#questions)

## Code of Conduct

This project is maintained by UC Davis for the educational community. We are committed to providing a welcoming and inclusive environment for all contributors. Please be respectful, constructive, and professional in all interactions.

## How Can I Contribute?

### For Educators and Non-Developers

You don't need to be a professional developer to contribute! Here are ways you can help:

- **Report bugs** you encounter while creating assignments
- **Suggest features** that would improve assignment creation
- **Improve documentation** by clarifying instructions
- **Share use cases** and feedback from your teaching experience
- **Test new features** and provide feedback
- **Share example assignments** that could help other educators

### For Developers

- Fix bugs and improve code quality
- Implement new features
- Improve PDF generation and Gradescope compatibility
- Write tests and documentation
- Review pull requests

## Reporting Bugs

Before creating a bug report, please check the [existing issues](https://github.com/BridgeSuite/GradeBridge-Assignment-Maker/issues) to avoid duplicates.

### How to Submit a Bug Report

1. Use the [bug report template](https://github.com/BridgeSuite/GradeBridge-Assignment-Maker/issues/new?template=bug_report.md)
2. Provide a clear, descriptive title
3. Include detailed steps to reproduce the issue
4. Describe what you expected to happen vs. what actually happened
5. Include browser information and screenshots if possible
6. Mention if the issue affects assignment export or PDF generation

**Important**: This is a client-side application. All bugs should be reproducible in a standard browser environment. Include your browser version and OS.

## Suggesting Features

We love hearing ideas for improving the assignment creation experience! Before suggesting a feature:

1. Check [existing feature requests](https://github.com/BridgeSuite/GradeBridge-Assignment-Maker/issues?q=is%3Aissue+is%3Aopen+label%3Aenhancement)
2. Consider whether it aligns with our goals:
   - **Client-side processing** (no server dependencies)
   - **Privacy-first** (data stays on educator's device)
   - **Gradescope compatibility**
   - **Educator-friendly** (intuitive interface)
   - **Student Submission app integration** (JSON format compatibility)

### How to Submit a Feature Request

1. Use the [feature request template](https://github.com/BridgeSuite/GradeBridge-Assignment-Maker/issues/new?template=feature_request.md)
2. Describe the problem or pain point
3. Propose a solution
4. Explain how it benefits educators and students
5. Consider compatibility with the Student Submission app

## Contributing Code

### Prerequisites

- Node.js (v18+)
- npm or yarn
- Git
- A modern code editor (VS Code recommended)
- Basic understanding of React and TypeScript

### Getting Started

1. **Fork the repository**
   ```bash
   # Click "Fork" on GitHub, then clone your fork:
   git clone https://github.com/YOUR_USERNAME/GradeBridge-Assignment-Maker.git
   cd GradeBridge-Assignment-Maker
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create a branch**
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/bug-description
   ```

4. **Make your changes**
   - Write clean, readable code
   - Follow existing code patterns
   - Add comments for complex logic
   - Update documentation if needed

5. **Test your changes**
   ```bash
   npm run dev      # Test in development mode
   npm run build    # Ensure it builds
   npm run preview  # Test the production build
   ```

6. **Commit your changes**
   ```bash
   git add .
   git commit -m "Brief description of changes"
   ```

   Use clear, concise commit messages:
   - `Add feature: Problem duplication`
   - `Fix: PDF generation with LaTeX equations`
   - `Update: README with new export options`

7. **Push and create a Pull Request**
   ```bash
   git push origin feature/your-feature-name
   ```
   Then open a PR on GitHub using our [PR template](../.github/PULL_REQUEST_TEMPLATE.md)

### Development Workflow

- **Keep PRs focused**: One feature or fix per PR
- **Update from main regularly**: Rebase or merge to stay current
- **Test thoroughly**: Especially JSON export and PDF generation
- **Document changes**: Update README or add inline comments
- **Be responsive**: Address review feedback promptly

## Style Guidelines

### TypeScript/React

- Use **TypeScript** with strict type checking
- Write **functional components** with hooks
- Follow **React best practices**:
  - Use descriptive component and variable names
  - Extract reusable logic into custom hooks
  - Keep components small and focused
  - Avoid prop drilling (use context when appropriate)

### Code Formatting

- Use **2 spaces** for indentation
- Use **single quotes** for strings
- Add **trailing commas** in multi-line arrays/objects
- Use **const** by default, **let** only when reassignment is needed
- Avoid **any** types - use proper TypeScript types

Example:
```typescript
// Good
const [assignmentTitle, setAssignmentTitle] = useState<string>('');

interface AssignmentProps {
  assignment: Assignment;
  onExport: (format: ExportFormat) => void;
}

export const AssignmentEditor: React.FC<AssignmentProps> = ({ assignment, onExport }) => {
  // Component logic
};

// Avoid
var title = '';  // Use const/let
const handleExport = (data: any) => {};  // Use proper types
```

### File Organization

- **Components**: One component per file
- **Naming**: PascalCase for components, camelCase for utilities
- **Location**: Place files in appropriate directories (components/, services/, types/)

### Comments

- Write self-documenting code with clear names
- Add comments for:
  - Complex algorithms or business logic
  - PDF generation logic
  - Gradescope-specific requirements
  - JSON format specifications
  - Educational context

```typescript
// Good: Explains why, not what
// Each subsection needs its own page to match Gradescope template regions
// This ensures auto-grading can map student answers to correct problems
const pagesNeeded = assignment.subsections.length;
```

## Testing Guidelines

### Manual Testing

Before submitting a PR, test:

1. **Core Workflows**
   - Create a new assignment
   - Add problems with subsections
   - Upload problem images
   - Use LaTeX in problem statements
   - Export to JSON
   - Export to PDF
   - Export to ZIP
   - Load existing assignment JSON

2. **Edge Cases**
   - Large assignments (20+ problems)
   - Complex LaTeX expressions
   - Large problem images
   - All submission type combinations

3. **Integration Testing**
   - Export JSON and test in Student Submission app
   - Generate PDF and upload to Gradescope
   - Verify page structure matches expectations

4. **Browser Compatibility**
   - Test on Chrome, Firefox, Safari, and Edge
   - Test on both desktop and tablet if possible

### Automated Testing

While we don't currently have a comprehensive test suite, contributions of tests are welcome:

- Unit tests for export services
- Integration tests for PDF generation
- Tests for JSON format validation

## Documentation

### Code Documentation

- Add JSDoc comments to exported functions and components
- Document complex types and interfaces
- Include examples for non-obvious usage

```typescript
/**
 * Generates a PDF template for Gradescope with proper page breaks
 * @param assignment - The complete assignment structure
 * @param options - PDF generation options (margins, format, etc.)
 * @returns Promise resolving to Blob containing the PDF
 */
export const generatePDF = async (
  assignment: Assignment,
  options: PDFOptions
): Promise<Blob> => {
  // ...
};
```

### User Documentation

If your change affects how educators use the app:

- Update the README.md
- Add examples or screenshots
- Document new JSON format fields
- Mention it in your PR description

## JSON Format Compatibility

### Critical: Maintain Backward Compatibility

Changes to the JSON export format must:

- **Be backward compatible** with existing assignments
- **Work with Student Submission app** (coordinate changes)
- **Document new fields** clearly
- **Include migration notes** if breaking changes are unavoidable

### Testing JSON Changes

If your PR modifies the JSON format:

1. Export a sample assignment
2. Test loading it in the Student Submission app
3. Verify all fields are correctly interpreted
4. Test PDF generation from both apps
5. Document the changes in your PR

## Privacy and Educational Context

### Privacy Requirements

All contributions **must maintain**:

- **Client-side processing**: No data sent to servers
- **LocalStorage only**: No cookies, tracking, or analytics
- **Export control**: Educators can backup and manage their data
- **No external dependencies** that compromise privacy

### Educational Considerations

Remember that this tool is used to create academic assessments:

- **Academic integrity**: Support fair assessment practices
- **Accessibility**: Consider students with disabilities in PDF output
- **Clarity**: Assignments should be clear and unambiguous
- **Flexibility**: Support diverse question types and disciplines
- **Gradescope compatibility**: Maintain PDF structure requirements

## Response Times

This is a community edition tool maintained by UC Davis as time permits. Please be patient:

- **Bug reports**: We aim to respond within 1 week
- **Feature requests**: May take longer to evaluate and implement
- **Pull requests**: We'll review as quickly as possible, usually within 2 weeks
- **Questions**: Check existing issues first; we'll respond when available

For urgent issues affecting active courses, please clearly mark them as such.

## Recognition

Contributors will be:

- Listed in release notes
- Credited in the README (for significant contributions)
- Added to the GitHub contributors list

## Questions?

- **General questions**: Open a [GitHub Discussion](https://github.com/BridgeSuite/GradeBridge-Assignment-Maker/discussions)
- **Bug reports**: Use the [bug template](https://github.com/BridgeSuite/GradeBridge-Assignment-Maker/issues/new?template=bug_report.md)
- **Feature ideas**: Use the [feature template](https://github.com/BridgeSuite/GradeBridge-Assignment-Maker/issues/new?template=feature_request.md)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for helping make GradeBridge better for educators and students!** 🎓
