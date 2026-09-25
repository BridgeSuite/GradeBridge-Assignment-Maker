import React, { useState, useEffect } from 'react';
import { ShieldCheck, Info, AlertCircle } from 'lucide-react';

/**
 * What a student receives, per path, as the export writes it today.
 *
 * WORKORDER_AM_NO_BROWSER_DIALOGS_2026-09-24, item 2. This notice said students
 * receive the contents of a `student/` folder: "the assignment PDF,
 * `assignment_spec.json`, and for a handwritten assignment the `layout_*.csv`
 * that must travel with the PDF". None of that has been true since 2026-09-06:
 * the file is `{stem}_OPEN_IN_APP.json`, the map travels inside it, and what
 * the instructor attaches is one package, `{stem}_FOR_STUDENTS.zip`. Since
 * 2026-09-24 the generic answer page is a third path with no PDF at all.
 *
 * `{stem}` is the course code and title joined as the export names files
 * (`exportFilenames` in `services/exportService.ts`). The suite exports one
 * assignment on each path and holds these lists to the files actually in its
 * student package, so this cannot drift from the export again without failing.
 */
export const STUDENT_PACKAGE_BY_PATH: ReadonlyArray<{
  path: string;
  files: ReadonlyArray<{ name: string; what: string }>;
}> = [
  {
    path: 'Electronic',
    files: [
      { name: '{stem}.pdf', what: 'the assignment, to read' },
      { name: '{stem}_OPEN_IN_APP.json', what: 'the file they open in the submission app' },
    ],
  },
  {
    path: 'Handwritten, on the printed sheet',
    files: [
      { name: '{stem}.pdf', what: 'the sheet they print and write on' },
      { name: '{stem}_OPEN_IN_APP.json', what: 'the file they open in the submission app; the sheet\'s map is inside it' },
    ],
  },
  {
    path: 'Handwritten, on the generic answer page',
    files: [
      { name: '{stem}_OPEN_IN_APP.json',
        what: 'the only file. It marks the assignment sheet: "generic" and carries the list of problems and '
          + 'parts and the generic answer page\'s map, and no question text: you post your questions '
          + 'yourself, and students write on the generic answer page' },
    ],
  },
];

const Code: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  <code className="font-mono">{children}</code>;

/** The notice's content, stateless, so the suite can render exactly what an instructor reads. */
export const PrivacyNoticeBody: React.FC = () => (
  <div className="p-6 space-y-4">
    <div className="flex items-start gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
      <ShieldCheck className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
      <div>
        <h3 className="font-bold text-green-900 mb-2">100% Local Execution</h3>
        <p className="text-green-800 text-sm">
          This application runs entirely in your browser. No assignment data, problem descriptions,
          or files are ever sent to a server. Your data remains completely private and under your control.
        </p>
      </div>
    </div>

    <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
      <Info className="w-6 h-6 text-blue-600 flex-shrink-0 mt-0.5" />
      <div>
        <h3 className="font-bold text-blue-900 mb-2">Data Persistence</h3>
        <p className="text-blue-800 text-sm">
          Your assignments are saved to your browser's "Local Storage". Please do not clear your
          browser cache while working on assignments. We strongly recommend using <strong>Export</strong> on
          the Assignment Dashboard frequently to create backups of your work. The file that restores an
          assignment completely is <Code>instructor/{'{stem}'}_authoring_backup.json</Code> inside
          {' '}<Code>{'{stem}'}_INSTRUCTOR_ONLY.zip</Code>, the file that export downloads.
        </p>
      </div>
    </div>

    {/* The largest remaining disclosure path is an instructor handing out the
        whole export, so this sits in the modal every instructor meets on first
        use — the highest-traffic place the sentence can be. */}
    <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
      <AlertCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
      <div>
        <h3 className="font-bold text-red-900 mb-2">The export contains the answer key</h3>
        <p className="text-red-800 text-sm">
          <strong>The export is for you. It MUST NOT be given to students.</strong> Four files
          in its <Code>instructor/</Code> folder contain answers: the grader document, the grading
          rubric, the authoring backup and the <Code>.md</Code> source.
        </p>
        <p className="text-red-800 text-sm mt-2">
          <strong>Students receive one file:</strong> <Code>{'{stem}'}_FOR_STUDENTS.zip</Code>, which sits
          on its own at the top of the export. Attach that and nothing else. The export also carries
          {' '}<Code>00_INSTRUCTOR_ONLY_DO_NOT_DISTRIBUTE.txt</Code>, naming every file. What the student
          package holds depends on how students answer:
        </p>
        <ul className="text-red-800 text-sm mt-2 space-y-2" data-student-package>
          {STUDENT_PACKAGE_BY_PATH.map(p => (
            <li key={p.path} data-path={p.path}>
              <strong>{p.path}:</strong>{' '}
              {p.files.map((f, i) => (
                <React.Fragment key={f.name}>
                  {i > 0 && '; '}
                  <Code>{f.name}</Code>, {f.what}
                </React.Fragment>
              ))}.
            </li>
          ))}
        </ul>
      </div>
    </div>

    <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
      <AlertCircle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
      <div>
        <h3 className="font-bold text-amber-900 mb-2">Important Recommendations</h3>
        <ul className="text-amber-800 text-sm space-y-1 list-disc list-inside">
          <li>Export your assignments regularly as backup files</li>
          <li>Use the same browser and device for consistent access to your data</li>
          <li>Avoid using private/incognito mode as it may clear your data when closed</li>
        </ul>
      </div>
    </div>

    <div className="border-t border-academic-200 pt-4">
      <h3 className="font-bold text-academic-900 mb-2">Disclaimer</h3>
      <p className="text-academic-600 text-sm">
        This software is provided "as is", without warranty of any kind, express or implied,
        including but not limited to the warranties of merchantability, fitness for a particular
        purpose and noninfringement. Copyright © 2026 The Regents of the University of
        California. This application is made available under the MIT License.
      </p>
    </div>

    <div className="border-t border-academic-200 pt-4">
      <p className="text-academic-500 text-xs text-center">
        Provided free of charge by <span className="font-bold text-[#00A4E4]">UC Davis</span>
      </p>
    </div>
  </div>
);

export const PrivacyNotice: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const hasSeenNotice = localStorage.getItem('privacyNoticeAccepted');
    if (!hasSeenNotice) {
      setIsVisible(true);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem('privacyNoticeAccepted', 'true');
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-5xl w-full max-h-[95vh] overflow-y-auto">
        <div className="bg-gradient-to-r from-academic-800 to-academic-900 text-white p-6 rounded-t-lg">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-8 h-8" />
            <div>
              <h2 className="text-2xl font-bold">Welcome to GradeBridge Assignment Maker</h2>
              <p className="text-academic-200 text-sm mt-1">Privacy & Data Notice</p>
            </div>
          </div>
        </div>

        <PrivacyNoticeBody />

        <div className="p-4 bg-academic-50 border-t border-academic-200 rounded-b-lg">
          <button
            onClick={handleAccept}
            className="w-full bg-academic-800 text-white py-2.5 px-6 rounded-md font-medium hover:bg-academic-900 transition-colors shadow-sm"
          >
            I Understand - Continue to Assignment Manager
          </button>
        </div>
      </div>
    </div>
  );
};
