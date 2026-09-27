import React from 'react';
import { Layout } from './Common';

/**
 * NOTICES: this app's own licence, and every third-party package compiled
 * into it with its licence and its notice in full
 * (WORKORDER_ATTRIBUTION_AND_THIRD_PARTY_NOTICES_2026-09-27).
 *
 * The list is not written here. The build generates `third-party-notices.json`
 * from the modules it actually bundled (`scripts/thirdPartyNotices.mjs`) and
 * refuses to build if any package has no notice text, so this page cannot
 * silently omit a library. A development server has no build, so there the
 * page says so rather than showing a partial list.
 */

interface Pkg {
  name: string;
  version: string;
  licence: string;
  licenceChosen?: string;
  noticeSource: string;
  notice: string;
}
interface Notices { project: { name: string; licence: string }; packages: Pkg[] }

export const NOTICES_TITLE = 'Notices';

/** Where the build puts the notices files. Read defensively: outside Vite (the test renderer) there is no `import.meta.env`. */
const BASE: string = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';

export const NoticesView: React.FC<{ notices: Notices | null; failed: boolean }> = ({ notices, failed }) => (
  <div className="space-y-8 text-sm text-academic-700">
    <section>
      <h3 className="text-lg font-semibold text-academic-900">This application</h3>
      <p className="mt-2">
        Copyright &copy; 2026 The Regents of the University of California. Made available under the
        MIT License:
      </p>
      {notices
        ? <pre className="mt-3 whitespace-pre-wrap rounded border border-academic-200 bg-white p-3 text-xs">{notices.project.licence}</pre>
        : null}
    </section>

    <section>
      <h3 className="text-lg font-semibold text-academic-900">Third-party software</h3>
      {!notices && (
        <p className="mt-2" data-notices-unavailable>
          {failed
            ? 'The list of third-party notices could not be loaded. It is generated when the app is built, '
              + 'as THIRD_PARTY_NOTICES.txt beside the app.'
            : 'Loading the third-party notices…'}
        </p>
      )}
      {notices && (
        <>
          <p className="mt-2">
            This app includes the following {notices.packages.length} packages, each under its own licence.
            The list is generated when the app is built, from the packages actually compiled into it.
            The same text is at{' '}
            <a className="underline" href={`${BASE}THIRD_PARTY_NOTICES.txt`}>THIRD_PARTY_NOTICES.txt</a>.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-xs" data-notices-table>
              <thead className="border-b border-academic-200 text-academic-500">
                <tr><th className="py-2 pr-4">Package</th><th className="py-2 pr-4">Version</th><th className="py-2">Licence</th></tr>
              </thead>
              <tbody>
                {notices.packages.map(p => (
                  <tr key={p.name} className="border-b border-academic-100">
                    <td className="py-1.5 pr-4 font-medium text-academic-900">{p.name}</td>
                    <td className="py-1.5 pr-4">{p.version}</td>
                    <td className="py-1.5">
                      {p.licence}
                      {p.licenceChosen && <span className="text-academic-500"> (used under {p.licenceChosen})</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-6 space-y-2">
            {notices.packages.map(p => (
              <details key={p.name} className="rounded border border-academic-200 bg-white" data-notice={p.name}>
                <summary className="cursor-pointer px-3 py-2 font-medium text-academic-900">
                  {p.name} {p.version} <span className="font-normal text-academic-500">({p.licenceChosen || p.licence})</span>
                </summary>
                <div className="border-t border-academic-100 px-3 py-2">
                  <p className="text-xs text-academic-500">Notice from {p.noticeSource}</p>
                  <pre className="mt-2 whitespace-pre-wrap text-xs">{p.notice}</pre>
                </div>
              </details>
            ))}
          </div>
        </>
      )}
    </section>
  </div>
);

const NoticesPage: React.FC = () => {
  const [notices, setNotices] = React.useState<Notices | null>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    fetch(`${BASE}third-party-notices.json`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(j => { if (live) setNotices(j as Notices); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);
  return (
    <Layout title={NOTICES_TITLE}>
      <NoticesView notices={notices} failed={failed} />
    </Layout>
  );
};

export default NoticesPage;
