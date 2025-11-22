import { Assignment, SubmissionType } from './types';
import { v4 as uuidv4 } from 'uuid';

/**
 * Example assignment to help new users understand the app.
 * This is a real-world lab report assignment demonstrating various features.
 */
export const createExampleAssignment = (): Assignment => {
  const now = Date.now();

  // Set due date to 14 days from now
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 14);

  return {
    id: uuidv4(),
    courseCode: 'ENG6',
    title: 'Mini-Project 2: Motion Analysis and Plotting Lab Report (Example)',
    dueDate: dueDate.toISOString().split('T')[0],
    dueTime: '23:59',
    preamble: `This is an EXAMPLE ASSIGNMENT to help you explore the Assignment Maker features.

You may submit as many times as you wish up until the deadline. However, late submissions are not accepted.

Note: It is a violation of academic integrity to submit code written by someone else or plots produced by someone else or by using another person's code.

Feel free to modify this example or delete it and create your own assignment!`,
    problems: [
      {
        id: uuidv4(),
        name: 'Summary of the Project',
        description: 'Students should summarize what they learned and accomplished.',
        subsections: [
          {
            id: uuidv4(),
            name: '',
            description: 'In your own words, write a short summary of what was done for this project. Include the key concepts you learned and any challenges you faced.',
            points: 4,
            submissionType: SubmissionType.TEXT,
            maxImages: 1
          }
        ]
      },
      {
        id: uuidv4(),
        name: 'Data Analysis',
        description: 'Submit your analysis plots and partner information.',
        subsections: [
          {
            id: uuidv4(),
            name: 'Your Data Plot',
            description: 'This question refers to your final result at the end of Step 1 in the lab manual. Include below the annotated plot produced from your own data. Make sure axes are labeled and the plot has a title.',
            points: 4,
            submissionType: SubmissionType.IMAGE,
            maxImages: 1
          },
          {
            id: uuidv4(),
            name: "Partner's Data Plot",
            description: "This question refers to Step 2 in the lab manual. Include below the annotated plot produced from your partner's data. Compare and contrast with your own results.",
            points: 4,
            submissionType: SubmissionType.IMAGE,
            maxImages: 1
          },
          {
            id: uuidv4(),
            name: '',
            description: "Your partner's name (for verification purposes)",
            points: 1,
            submissionType: SubmissionType.TEXT,
            maxImages: 1
          }
        ]
      },
      {
        id: uuidv4(),
        name: 'Use of AI',
        description: `If you used AI for any aspect of your lab, you must complete a short reflection documenting your AI use.

You must also attach a log (either as a text log, or screenshots) of your interaction with AI. Your log does not need to be exhaustive, but should provide a reasonable overview of your interaction with the AI.

Provide 1-3 sentences in answer to each question below:`,
        subsections: [
          {
            id: uuidv4(),
            name: 'AI Tools Used',
            description: 'Which AI tool(s) did you use? E.g. Cursor, ChatGPT, Gemini, Claude, GitHub Copilot, etc.',
            points: 2,
            submissionType: SubmissionType.TEXT,
            maxImages: 1
          },
          {
            id: uuidv4(),
            name: 'How AI Was Used',
            description: 'Describe how you used AI in your lab. E.g. to help with debugging, to suggest ways to improve efficiency/clarity of your code, to explain concepts, etc.',
            points: 2,
            submissionType: SubmissionType.TEXT,
            maxImages: 1
          },
          {
            id: uuidv4(),
            name: 'Verification Steps',
            description: 'What steps did you take to verify that the responses given to you by the AI were accurate and appropriate for your work?',
            points: 2,
            submissionType: SubmissionType.TEXT,
            maxImages: 1
          },
          {
            id: uuidv4(),
            name: 'AI Chat Logs',
            description: 'Attach your AI chat logs here as screenshots or images. Include the key prompts you used.',
            points: 4,
            submissionType: SubmissionType.IMAGE,
            maxImages: 3
          }
        ]
      },
      {
        id: uuidv4(),
        name: 'Mathematical Analysis (Bonus Example)',
        description: `This section demonstrates LaTeX support in questions. You can use LaTeX notation like $E = mc^2$ for inline math or display equations like:

$$\\frac{d}{dt}\\left(\\frac{\\partial L}{\\partial \\dot{q}}\\right) - \\frac{\\partial L}{\\partial q} = 0$$

Try typing LaTeX in your assignment questions!`,
        subsections: [
          {
            id: uuidv4(),
            name: 'Equation Derivation',
            description: `Derive the equation of motion for the system. Your answer should include:

- The kinematic equations used
- Show that $v = v_0 + at$ leads to $x = x_0 + v_0 t + \\frac{1}{2}at^2$
- Explain each step clearly`,
            points: 5,
            submissionType: SubmissionType.TEXT,
            maxImages: 2
          }
        ]
      }
    ],
    createdAt: now,
    updatedAt: now
  };
};

/**
 * Message shown when example assignment is loaded
 */
export const EXAMPLE_LOADED_MESSAGE = 'Example assignment loaded! Explore the features, then modify or delete it.';
