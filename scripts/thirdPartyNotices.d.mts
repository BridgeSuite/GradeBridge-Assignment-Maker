export interface ThirdPartyPackage {
  name: string;
  version: string;
  licence: string;
  /** Set only for a dual-licensed package: the licence this project uses it under. */
  licenceChosen?: string;
  noticeSource: string;
  notice: string;
}
export declare const DUAL_LICENCE_CHOICE: Record<string, string>;
export declare const NOTICE_FROM_SOURCE_HEADER: Record<string, string>;
export declare const packageDirOf: (id: string) => string | null;
export declare const collectNotices: (moduleIds: Iterable<string>) => { packages: ThirdPartyPackage[]; problems: string[] };
export declare const noticesText: (project: { name: string; licence: string }, packages: ThirdPartyPackage[]) => string;
