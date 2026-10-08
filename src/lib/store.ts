export type ProjectStatus = 'active' | 'completed' | 'on-hold';
export type ItemStatus = 'pending' | 'partial' | 'complete';

export const UNIT_OPTIONS = ['Piece', 'Meter', 'Kg', 'Liter', 'Box', 'Roll', 'Pack'] as const;
export type StandardUnit = typeof UNIT_OPTIONS[number];

export type Item = {
  id: string;
  name: string;
  photo?: string;
  quantity: number;
  unit: string;
  notes: string;
  status: ItemStatus;
  createdAt: string;
  updatedAt: string;
};

export type Project = {
  id: string;
  name: string;
  client: string;
  location: string;
  description: string;
  notes: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  items: Item[];
};

const STORAGE_KEY = 'material-inventory-projects-v1';
const uid = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const now = () => new Date().toISOString();
let storageNotice: string | null = null;

export function reportStorageIssue(message: string) {
  storageNotice = message;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('material-storage-error', { detail: message }));
}

export function getStorageNotice() {
  return storageNotice;
}

export function createItem(values: Pick<Item, 'name' | 'quantity' | 'unit' | 'notes'> & Partial<Pick<Item, 'photo'>>): Item {
  const stamp = now();
  const quantity = Math.max(0, Number(values.quantity) || 0);
  return {
    id: uid(),
    name: values.name,
    photo: values.photo,
    quantity,
    unit: values.unit,
    notes: values.notes ?? '',
    status: quantity > 0 ? 'complete' : 'pending',
    createdAt: stamp,
    updatedAt: stamp,
  };
}

const seed: Project[] = [{
  id: 'northline-lobby',
  name: 'Northline Lobby Renovation',
  client: 'Northline Properties',
  location: '1840 Market Street',
  description: 'Interior refresh for the north lobby, reception desk, and adjacent corridor.',
  notes: 'Verify loading bay quantities before the next delivery.',
  status: 'active',
  createdAt: '2026-08-06T09:00:00.000Z',
  updatedAt: '2026-08-14T16:30:00.000Z',
  items: [
    createSeedItem({ id: 'nl-drywall', name: '5/8" Type X drywall', unit: 'Piece', quantity: 48, notes: 'Stacked in loading bay.' }),
    createSeedItem({ id: 'nl-stud', name: '3-5/8" metal studs', unit: 'Piece', quantity: 88 }),
    createSeedItem({ id: 'nl-adhesive', name: 'Construction adhesive', unit: 'Pack', quantity: 11 }),
    createSeedItem({ id: 'nl-paint', name: 'Low-VOC interior paint', unit: 'Liter', quantity: 0, notes: 'Confirm color before ordering.' }),
    createSeedItem({ id: 'nl-trim', name: 'Oak wall trim', unit: 'Meter', quantity: 0 }),
  ],
}];

function createSeedItem(values: { id: string; name: string; unit: string; quantity: number; notes?: string }): Item {
  const stamp = '2026-08-14T16:30:00.000Z';
  return { ...values, notes: values.notes ?? '', status: values.quantity > 0 ? 'complete' : 'pending', createdAt: stamp, updatedAt: stamp };
}

function normalizeItem(raw: Partial<Item> & { plannedQuantity?: number; countedQuantity?: number; category?: string }): Item {
  const quantity = raw.quantity ?? raw.countedQuantity ?? raw.plannedQuantity ?? 0;
  return {
    id: raw.id ?? uid(),
    name: raw.name ?? 'Untitled material',
    photo: raw.photo,
    quantity: Math.max(0, Number(quantity) || 0),
    unit: raw.unit ?? 'Piece',
    notes: raw.notes ?? (raw.category ? `Category: ${raw.category}` : ''),
    status: Number(quantity) > 0 ? 'complete' : 'pending',
    createdAt: raw.createdAt ?? now(),
    updatedAt: raw.updatedAt ?? now(),
  };
}

export function loadProjects(): Project[] {
  if (typeof window === 'undefined') return seed;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    reportStorageIssue('Project storage is unavailable. Changes may not be saved on this device.');
    return seed;
  }
  if (!raw) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    } catch {
      reportStorageIssue('Project storage is unavailable. Changes may not be saved on this device.');
    }
    return seed;
  }
  try {
    const parsed = JSON.parse(raw) as Array<Partial<Project>>;
    if (!Array.isArray(parsed)) {
      reportStorageIssue('Saved project data could not be read. Your stored data has not been changed.');
      return seed;
    }
    return parsed.map((project) => ({ ...project, items: Array.isArray(project.items) ? project.items.map(normalizeItem) : [] })) as Project[];
  } catch {
    reportStorageIssue('Saved project data could not be read. Your stored data has not been changed.');
    return seed;
  }
}

export function saveProjects(projects: Project[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  storageNotice = null;
  window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
}

export function createProject(values: Pick<Project, 'name' | 'client' | 'location' | 'description' | 'notes' | 'status'>): Project {
  const stamp = now();
  return { ...values, id: uid(), createdAt: stamp, updatedAt: stamp, items: [] };
}

export function getProgress(project: Project) {
  const total = project.items.length;
  const complete = project.items.filter((entry) => entry.quantity > 0).length;
  return { total, complete, percent: total ? Math.round((complete / total) * 100) : 0 };
}

export { STORAGE_KEY };