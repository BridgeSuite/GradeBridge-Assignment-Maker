
import { Assignment } from '../types';
import { degradeRetiredTypes } from './retiredTypes';

const STORAGE_KEY = 'gradebridge_assignments_v1';

export const storageService = {
  getAll: (): Assignment[] => {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (!data) return [];

      const parsed = JSON.parse(data);
      if (!Array.isArray(parsed)) return [];

      // normalize IDs to strings and trim whitespace to prevent mismatch issues
      // also ensure createdAt and updatedAt exist as numbers
      const now = Date.now();
      return parsed.map((a: any) => {
        const assignment: Assignment = {
          ...a,
          id: String(a.id).trim(),
          createdAt: typeof a.createdAt === 'number' ? a.createdAt : now,
          updatedAt: typeof a.updatedAt === 'number' ? a.updatedAt : now
        };
        // An assignment saved before a submission type was retired loads with
        // that part as plain Text — an unknown type would render blank in the
        // editor and export as `human` without anyone being told.
        for (const w of degradeRetiredTypes(assignment)) console.warn(`[GradeBridge] ${w}`);
        return assignment;
      });
    } catch (error) {
      console.error("Failed to load assignments", error);
      return [];
    }
  },

  get: (id: string): Assignment | undefined => {
    const all = storageService.getAll();
    const targetId = String(id).trim();
    return all.find(a => a.id === targetId);
  },

  save: (assignment: Assignment): void => {
    const all = storageService.getAll();
    // Ensure ID is string and trimmed to prevent duplicates/mismatches
    const safeAssignment = { ...assignment, id: String(assignment.id).trim() };
    
    const index = all.findIndex(a => a.id === safeAssignment.id);
    
    if (index >= 0) {
      all[index] = { ...safeAssignment, updatedAt: Date.now() };
    } else {
      all.push({ ...safeAssignment, createdAt: Date.now(), updatedAt: Date.now() });
    }
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  },

  delete: (id: string): void => {
    const all = storageService.getAll();
    const targetId = String(id).trim();
    // Filter out the assignment, ensuring comparison is done on trimmed strings
    const filtered = all.filter(a => String(a.id).trim() !== targetId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  }
};
