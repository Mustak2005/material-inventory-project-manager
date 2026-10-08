import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Route, Switch, useLocation, useParams } from 'wouter';
import { jsPDF } from 'jspdf';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerSrc from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import {
  ArrowLeft, Archive, Check, CheckCircle2, ChevronRight, CircleAlert, ClipboardList,
  Copy, Download, FolderOpen, Grid2X2, ImagePlus, List, MapPin, Menu, Moon, Package, Pencil, Plus, Save,
  Search, SlidersHorizontal, Sun, Trash2, Users, X,
} from 'lucide-react';
import { createItem, createProject, getProgress, getStorageNotice, loadProjects, reportStorageIssue, saveProjects, UNIT_OPTIONS, type Item, type Project, type ProjectStatus } from '@/lib/store';

const projectStatus: Record<ProjectStatus, string> = { active: 'Active', completed: 'Completed', 'on-hold': 'On hold' };
const dateText = (date: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date));
const relativeText = (date: string) => { const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400000); return days <= 0 ? 'Updated today' : days === 1 ? 'Updated yesterday' : `Updated ${days} days ago`; };
const cx = (...values: Array<string | false | undefined>) => values.filter(Boolean).join(' ');
const isStandardUnit = (unit: string) => (UNIT_OPTIONS as readonly string[]).includes(unit);
const unitLabel = (unit: string) => unit || 'Piece';

const REPORT_BLUE = [16, 91, 157] as const;
const REPORT_INK = [24, 43, 64] as const;
const REPORT_MUTED = [89, 108, 126] as const;
const moneySafeFileName = (name: string, extension: string) => `${name.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'project'}-${new Date().toISOString().slice(0, 10)}.${extension}`;
const downloadText = (content: string, fileName: string, type: string) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const formatQuantity = (quantity: number) => Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');

const PDF_BACKUP_MARKER = 'MATERIAL_INVENTORY_PROJECT_BACKUP_V1:';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

const encodeBackupForPdf = (project: Project) => {
  const backup = {
    format: 'material-inventory-project',
    version: 1,
    exportedAt: new Date().toISOString(),
    project: {
      ...project,
      // Keep the PDF backup compact. Photos remain available in JSON backups.
      items: project.items.map((item) => ({ ...item, photo: undefined })),
    },
  };
  const json = JSON.stringify(backup);
  return btoa(unescape(encodeURIComponent(json)));
};

const decodeBackupFromPdf = (encoded: string) => {
  try {
    return JSON.parse(decodeURIComponent(escape(atob(encoded))));
  } catch {
    return null;
  }
};

function exportProjectJson(project: Project) {
  const backup = {
    format: 'material-inventory-project',
    version: 1,
    exportedAt: new Date().toISOString(),
    project,
  };

  const json = JSON.stringify(backup, null, 2);
  const fileName = moneySafeFileName(project.name, 'json');

  downloadText(json, fileName, 'application/json;charset=utf-8');
}

function tryExportProjectPdf(project: Project) {
  try {
    exportProjectPdf(project);
    return true;
  } catch {
    return false;
  }
}

function tryExportProjectJson(project: Project) {
  try {
    exportProjectJson(project);
    return true;
  } catch {
    return false;
  }
}

function groupedTotals(project: Project) {
  return project.items.reduce<Record<string, number>>((totals, item) => { totals[item.unit] = (totals[item.unit] ?? 0) + item.quantity; return totals; }, {});
}

function exportProjectPdf(project: Project) {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const pdfBackup = encodeBackupForPdf(project);
  pdf.setProperties({
    title: project.name,
    subject: `${PDF_BACKUP_MARKER}${pdfBackup}`,
    creator: 'Material & Inventory Project Manager',
    author: 'Shaik Mohammed Mustak',
  });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 42;
  const contentWidth = pageWidth - margin * 2;
  const footerHeight = 28;
  const drawFooter = () => {
    const page = pdf.getCurrentPageInfo().pageNumber;
    const totalPages = pdf.getNumberOfPages();
    pdf.setDrawColor(220, 228, 235); pdf.line(margin, pageHeight - footerHeight, pageWidth - margin, pageHeight - footerHeight);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(...REPORT_MUTED);
    pdf.text('Material & Inventory Project Manager', margin, pageHeight - 13);
    pdf.text('Developed by Shaik Mohammed Mustak', pageWidth / 2, pageHeight - 13, { align: 'center' });
    pdf.text(`Page ${page} of ${totalPages}`, pageWidth - margin, pageHeight - 13, { align: 'right' });
  };
  const drawHeader = (continuation = false) => {
    pdf.setFillColor(...REPORT_BLUE); pdf.rect(0, 0, pageWidth, 8, 'F');
    pdf.setTextColor(...REPORT_BLUE); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.text('MATERIAL & INVENTORY', margin, 38);
    pdf.setTextColor(...REPORT_INK); pdf.setFontSize(22); pdf.text(continuation ? 'PROJECT REPORT · CONTINUED' : 'PROJECT REPORT', margin, 64);
    pdf.setDrawColor(220, 228, 235); pdf.line(margin, 78, pageWidth - margin, 78);
  };
  const drawTableHeader = (y: number) => {
    const columns = [0, 48, 264, 350, 405];
    pdf.setFillColor(235, 243, 249); pdf.roundedRect(margin, y - 15, contentWidth, 27, 4, 4, 'F');
    pdf.setTextColor(...REPORT_MUTED); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8);
    ['PHOTO', 'ITEM', 'QUANTITY', 'UNIT', 'NOTES'].forEach((label, index) => pdf.text(label, margin + columns[index] + 7, y));
    return y + 29;
  };
  const drawRow = (item: Project['items'][number], y: number) => {
    const columns = [0, 48, 264, 350, 405];
    pdf.setDrawColor(225, 231, 236); pdf.line(margin, y + 34, margin + contentWidth, y + 34);
    if (item.photo) {
      try { pdf.addImage(item.photo, 'JPEG', margin + 7, y - 8, 31, 31, undefined, 'FAST'); } catch { pdf.setTextColor(...REPORT_MUTED); pdf.text('—', margin + 20, y + 12, { align: 'center' }); }
    } else { pdf.setTextColor(...REPORT_MUTED); pdf.text('—', margin + 22, y + 12, { align: 'center' }); }
    pdf.setTextColor(...REPORT_INK); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.text(item.name.slice(0, 38), margin + columns[1] + 7, y + 4);
    pdf.setFont('helvetica', 'normal'); pdf.text(formatQuantity(item.quantity), margin + columns[2] + 7, y + 4);
    pdf.text(item.unit.slice(0, 16), margin + columns[3] + 7, y + 4);
    pdf.setTextColor(...REPORT_MUTED); pdf.setFontSize(8); pdf.text(item.notes ? item.notes.slice(0, 42) : '—', margin + columns[4] + 7, y + 4);
    return y + 45;
  };
  drawHeader();
  let y = 108;
  pdf.setTextColor(...REPORT_INK); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(18); pdf.text(project.name.slice(0, 70), margin, y);
  y += 22; pdf.setTextColor(...REPORT_MUTED); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.text(`Report date: ${dateText(new Date().toISOString())}`, margin, y);
  y += 22; pdf.setFontSize(10); pdf.setTextColor(...REPORT_INK); pdf.setFont('helvetica', 'bold'); pdf.text('PROJECT SUMMARY', margin, y); y += 17;
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9);
  const summaryRows = [['Description', project.description || '—'], ['Location', project.location || '—'], ['Notes', project.notes || '—'], ['Total different items', String(project.items.length)]];
  summaryRows.forEach(([label, value]) => { pdf.setTextColor(...REPORT_MUTED); pdf.text(label, margin, y); pdf.setTextColor(...REPORT_INK); pdf.text(value.slice(0, 100), margin + 108, y); y += 16; });
  y += 5; pdf.setTextColor(...REPORT_INK); pdf.setFont('helvetica', 'bold'); pdf.text('QUANTITY BY UNIT', margin, y); y += 16;
  pdf.setFont('helvetica', 'normal'); const totals = groupedTotals(project); const totalEntries = Object.entries(totals);
  if (!totalEntries.length) { pdf.setTextColor(...REPORT_MUTED); pdf.text('No quantities recorded', margin, y); y += 16; }
  else totalEntries.forEach(([unit, quantity]) => { pdf.setTextColor(...REPORT_BLUE); pdf.setFont('helvetica', 'bold'); pdf.text(`${unit}:`, margin, y); pdf.setTextColor(...REPORT_INK); pdf.setFont('helvetica', 'normal'); pdf.text(formatQuantity(quantity), margin + 100, y); y += 15; });
  y += 17; pdf.setTextColor(...REPORT_INK); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.text('ITEM INVENTORY', margin, y); y += 15; y = drawTableHeader(y);
  project.items.forEach((item) => { if (y + 45 > pageHeight - footerHeight - 12) { pdf.addPage(); drawHeader(true); y = drawTableHeader(98); } y = drawRow(item, y); });
  for (let page = 1; page <= pdf.getNumberOfPages(); page += 1) { pdf.setPage(page); drawFooter(); }
  pdf.save(moneySafeFileName(project.name, 'pdf'));
}

function printProject(project: Project) {
  return tryExportProjectPdf(project);
}

async function importProjectPdf(file: File): Promise<Project | null> {
  if (file.size > 25 * 1024 * 1024) return null;

  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: buffer });
  const pdf = await loadingTask.promise;

  try {
    const metadata = await pdf.getMetadata();
    const info = metadata.info as Record<string, unknown> | undefined;
    const subject = typeof info?.Subject === 'string' ? info.Subject : '';

    if (!subject.startsWith(PDF_BACKUP_MARKER)) return null;

    const encoded = subject.slice(PDF_BACKUP_MARKER.length);
    return normalizeImportedProject(decodeBackupFromPdf(encoded));
  } finally {
  }
}

function normalizeImportedProject(raw: unknown): Project | null {
  if (!raw || typeof raw !== 'object') return null;

  const wrapper = raw as {
    format?: unknown;
    version?: unknown;
    project?: unknown;
  };

  // Accept our official backup format, while also accepting a raw Project object.
  const candidate =
    wrapper.format === 'material-inventory-project' &&
    wrapper.project &&
    typeof wrapper.project === 'object'
      ? wrapper.project
      : raw;

  if (!candidate || typeof candidate !== 'object') return null;

  const source = candidate as Partial<Project> & {
    items?: Array<Partial<Project['items'][number]>>;
  };

  if (
    typeof source.name !== 'string' ||
    !source.name.trim() ||
    !Array.isArray(source.items)
  ) {
    return null;
  }

  const stamp = new Date().toISOString();
  const items: Item[] = [];

  for (const [index, rawItem] of source.items.entries()) {
    if (
      !rawItem ||
      typeof rawItem !== 'object' ||
      typeof rawItem.name !== 'string' ||
      !rawItem.name.trim() ||
      typeof rawItem.quantity !== 'number' ||
      !Number.isFinite(rawItem.quantity) ||
      rawItem.quantity < 0 ||
      typeof rawItem.unit !== 'string' ||
      !rawItem.unit.trim()
    ) {
      return null;
    }

    items.push({
      id:
        typeof rawItem.id === 'string' && rawItem.id.trim()
          ? rawItem.id
          : `imported-item-${Date.now()}-${index}`,
      name: rawItem.name.trim(),
      photo:
        typeof rawItem.photo === 'string' && rawItem.photo.trim()
          ? rawItem.photo
          : undefined,
      quantity: Number(rawItem.quantity),
      unit: rawItem.unit.trim(),
      notes: typeof rawItem.notes === 'string' ? rawItem.notes : '',
      status: rawItem.quantity > 0 ? 'complete' : 'pending',
      createdAt:
        typeof rawItem.createdAt === 'string' ? rawItem.createdAt : stamp,
      updatedAt:
        typeof rawItem.updatedAt === 'string' ? rawItem.updatedAt : stamp,
    });
  }

  return {
    id:
      typeof source.id === 'string' && source.id.trim()
        ? source.id
        : `imported-${Date.now()}`,
    name: source.name.trim(),
    client: typeof source.client === 'string' ? source.client : '',
    location: typeof source.location === 'string' ? source.location : '',
    description:
      typeof source.description === 'string' ? source.description : '',
    notes: typeof source.notes === 'string' ? source.notes : '',
    status:
      source.status === 'completed' || source.status === 'on-hold'
        ? source.status
        : 'active',
    createdAt:
      typeof source.createdAt === 'string' ? source.createdAt : stamp,
    updatedAt:
      typeof source.updatedAt === 'string' ? source.updatedAt : stamp,
    items,
  };
}

function useProjects() {
  const [projects, setProjects] = useState<Project[]>(() => loadProjects());
  useEffect(() => { const sync = () => setProjects(loadProjects()); window.addEventListener('storage', sync); return () => window.removeEventListener('storage', sync); }, []);
  const commit = (next: Project[]) => {
    try {
      saveProjects(next);
      setProjects(next);
      return true;
    } catch {
      reportStorageIssue('Could not save changes on this device. Check available storage and try again.');
      return false;
    }
  };
  return { projects, commit };
}

function readTheme() {
  try {
    return localStorage.getItem('material-theme') ?? 'light';
  } catch {
    reportStorageIssue('Theme preference could not be read or saved on this device.');
    return 'light';
  }
}

function App() {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try { localStorage.setItem('material-theme', theme); }
    catch { reportStorageIssue('Theme preference could not be saved on this device.'); }
  }, [theme]);
  return <>
    <Switch>
    <Route path="/projects/new"><Shell theme={theme} setTheme={setTheme}><ProjectForm /></Shell></Route>
    <Route path="/projects/:id/edit"><Shell theme={theme} setTheme={setTheme}><ProjectForm /></Shell></Route>
    <Route path="/projects/:id/items/new"><Shell theme={theme} setTheme={setTheme}><ItemForm /></Shell></Route>
    <Route path="/projects/:id/items"><Shell theme={theme} setTheme={setTheme}><ItemList /></Shell></Route>
    <Route path="/projects/:id"><Shell theme={theme} setTheme={setTheme}><ProjectDetails /></Shell></Route>
    <Route path="/"><Shell theme={theme} setTheme={setTheme}><Dashboard /></Shell></Route>
    <Route><Shell theme={theme} setTheme={setTheme}><NotFound /></Shell></Route>
    </Switch>
    <GlobalNotice />
  </>;
}

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
};

function InstallAppAction() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [iosInstall, setIosInstall] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean };
    const standalone = window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
    const isAppleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!standalone && isAppleMobile) setIosInstall(true);
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const handleInstalled = () => { setInstallPrompt(null); setIosInstall(false); };
    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const install = async () => {
    if (!installPrompt) return;
    try {
      await installPrompt.prompt();
      await installPrompt.userChoice;
      setInstallPrompt(null);
    } catch {
      window.dispatchEvent(new CustomEvent('material-app-error', { detail: 'Installation could not be started. Try your browser menu instead.' }));
    }
  };

  if (!installPrompt && !iosInstall) return null;
  return <>
    <button className="ghost-button install-button" onClick={() => installPrompt ? void install() : setHelpOpen(true)} data-testid="button-install-app">
      <Download size={15} /> <span>{iosInstall && !installPrompt ? 'Add to Home' : 'Install app'}</span>
    </button>
    {helpOpen && <div className="confirm-backdrop" onClick={() => setHelpOpen(false)}>
      <section className="confirm-card install-help" role="dialog" aria-modal="true" aria-labelledby="install-help-title" onClick={(event) => event.stopPropagation()}>
        <button className="icon-button install-help-close" onClick={() => setHelpOpen(false)} aria-label="Close installation instructions"><X size={16} /></button>
        <h2 id="install-help-title">Add to Home Screen</h2>
        <p>On your iPhone or iPad, use Safari to open this app, then:</p>
        <ol><li>Tap the Share button.</li><li>Choose <strong>Add to Home Screen</strong>.</li><li>Tap <strong>Add</strong> to install the app.</li></ol>
        <div className="confirm-actions"><button className="primary-button" onClick={() => setHelpOpen(false)}>Done</button></div>
      </section>
    </div>}
  </>;
}

function GlobalNotice() {
  const [message, setMessage] = useState(() => getStorageNotice() ?? '');
  useEffect(() => {
    const show = (event: Event) => setMessage((event as CustomEvent<string>).detail || 'The requested action could not be completed.');
    window.addEventListener('material-storage-error', show);
    window.addEventListener('material-app-error', show);
    if (getStorageNotice()) setMessage(getStorageNotice()!);
    return () => {
      window.removeEventListener('material-storage-error', show);
      window.removeEventListener('material-app-error', show);
    };
  }, []);
  if (!message) return null;
  return <div className="global-notice" role="alert" data-testid="status-global-notice">
    <CircleAlert size={17} /><span>{message}</span>
    <button className="notice-close" onClick={() => setMessage('')} aria-label="Dismiss message"><X size={15} /></button>
  </div>;
}

function Shell({ children, theme, setTheme }: { children: ReactNode; theme: string; setTheme: (value: string) => void }) {
  const [location] = useLocation(); const [menuOpen, setMenuOpen] = useState(false);
  const crumb = location === '/' ? 'Workspace' : location.includes('/items') ? 'Inventory' : location.includes('/edit') ? 'Project editor' : location.includes('/new') ? 'New project' : 'Project overview';
  return <div className="app-shell"><aside className={cx('sidebar', menuOpen && 'open')}>
    <Link href="/" className="brand" data-testid="link-brand"><span className="brand-mark"><Package size={18} strokeWidth={2.5} /></span><span><span className="brand-name">Material<span style={{ color: 'hsl(var(--primary))' }}>.</span></span><span className="brand-sub">Field inventory</span></span></Link>
    <div className="nav-label">Workspace</div><Link href="/" className={cx('nav-item', location === '/' && 'active')} data-testid="link-dashboard"><ClipboardList size={16} /> Home</Link><Link href="/" className={cx('nav-item', location !== '/' && 'active')} data-testid="link-projects"><Archive size={16} /> Projects</Link>
    <div className="sidebar-footer"><div className="offline-note"><span className="offline-dot" /><span><strong>Local workspace</strong><br />Changes save on this device.</span></div></div>
  </aside>{menuOpen && <button className="confirm-backdrop" style={{ zIndex: 15, background: 'transparent' }} onClick={() => setMenuOpen(false)} aria-label="Close menu" data-testid="button-close-menu" />}
  <main className="main-wrap"><header className="topbar"><div className="crumb"><button className="mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Open navigation" data-testid="button-open-menu"><Menu size={18} /></button><span>Material</span><ChevronRight size={13} /><strong>{crumb}</strong></div><div className="top-actions"><InstallAppAction /><button className="icon-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme" data-testid="button-theme-toggle">{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button><Link href="/projects/new" className="primary-button" data-testid="link-create-project"><Plus size={16} /><span>New project</span></Link></div></header>{children}<footer className="app-footer">Developed by Shaik Mohammed Mustak</footer></main></div>;
}

function Dashboard() {
  const { projects, commit } = useProjects(); const [search, setSearch] = useState(''); const [view, setView] = useState<'grid' | 'list'>('grid'); const [confirmId, setConfirmId] = useState<string | null>(null); const [toast, setToast] = useState('');
  const filtered = useMemo(() => projects.filter((project) => `${project.name} ${project.client} ${project.location}`.toLowerCase().includes(search.toLowerCase())), [projects, search]);
  const stats = { items: projects.reduce((sum, project) => sum + project.items.length, 0), complete: projects.reduce((sum, project) => sum + project.items.filter((entry) => entry.quantity > 0).length, 0), active: projects.filter((project) => project.status === 'active').length };
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2400); };
  const duplicate = (project: Project) => { const stamp = Date.now(); const copy = { ...project, id: `${project.id}-copy-${stamp}`, name: `${project.name} — copy`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), items: project.items.map((entry) => ({ ...entry, id: `${entry.id}-copy-${stamp}` })) }; if (!commit([copy, ...projects])) return; notify('Project duplicated'); };
  const remove = () => { if (!confirmId) return; if (!commit(projects.filter((project) => project.id !== confirmId))) return; setConfirmId(null); notify('Project deleted'); };
  const exportPdf = (project: Project) => { if (!tryExportProjectPdf(project)) notify('PDF export could not be completed. Try again.'); };
  const saveBackup = (project: Project) => {
    if (!tryExportProjectJson(project)) notify('Backup could not be saved. Try again.');
    else notify(`Backup saved for ${project.name}`);
  };

  const importBackup = async (file?: File) => {
    if (!file) return;

    try {
      if (file.size > 25 * 1024 * 1024) {
        notify('This file is too large. Maximum size is 25 MB.');
        return;
      }

      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

      if (isPdf) {
        const restored = await importProjectPdf(file);
        if (!restored) {
          notify('This PDF was not created by Material & Inventory Project Manager.');
          return;
        }

        const id = projects.some((project) => project.id === restored.id)
          ? `${restored.id}-import-${Date.now()}`
          : restored.id;
        if (!commit([{ ...restored, id }, ...projects])) return;
        notify(`Project restored from PDF: ${restored.name}`);
        return;
      }

      const text = (await file.text()).replace(/^\uFEFF/, '').trim();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        console.error('Backup parse error:', error);
        notify('This backup file could not be read. Please choose a backup saved by this app.');
        return;
      }

      const restored = normalizeImportedProject(parsed);
      if (!restored) {
        notify('This backup file is not a valid Material & Inventory project backup.');
        return;
      }

      const id = projects.some((project) => project.id === restored.id)
        ? `${restored.id}-import-${Date.now()}`
        : restored.id;
      if (!commit([{ ...restored, id }, ...projects])) return;
      notify(`Project restored: ${restored.name}`);
    } catch (error) {
      console.error('Restore error:', error);
      notify('The project could not be restored. Please select a backup created by this app.');
    }
  };
  return <div className="page"><div className="page-head"><div><div className="eyebrow">Operations workspace</div><h1 className="page-title">Keep the count moving.</h1><p className="page-lede">A dependable place to plan, count, and close out material on every site.</p></div><div className="page-head-actions"><label className="ghost-button import-button"><FolderOpen size={15} /> Restore Project<input type="file" accept=".json,.pdf,application/json,application/pdf" hidden onChange={(event) => { void importBackup(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} data-testid="input-restore-project" /></label><Link href="/projects/new" className="primary-button" data-testid="button-create-project"><Plus size={17} /> Create new project</Link></div></div>
    <div className="stats-row"><Stat icon={<Archive size={15} />} label="Projects" value={projects.length} note={`${stats.active} currently active`} /><Stat icon={<Package size={15} />} label="Material lines" value={stats.items} note="Across all projects" /><Stat icon={<CheckCircle2 size={15} />} label="Lines counted" value={stats.complete} note={stats.items ? `${Math.round(stats.complete / stats.items * 100)}% with quantity` : 'Ready to begin'} /><Stat icon={<CircleAlert size={15} />} label="Needs attention" value={Math.max(stats.items - stats.complete, 0)} note="No quantity yet" /></div>
    <div className="section-head"><div><div className="section-title">Your projects</div><div className="section-kicker">Everything stored locally on this device</div></div></div><div className="toolbar"><label className="search-box"><Search size={16} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search projects, clients, sites..." aria-label="Search projects" data-testid="input-search-projects" /></label><div className="view-toggle"><button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} aria-label="Grid view" data-testid="button-grid-view"><Grid2X2 size={15} /></button><button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} aria-label="List view" data-testid="button-list-view"><List size={15} /></button></div></div>
     {filtered.length === 0 ? <Empty title={search ? 'No matching projects found.' : 'No projects yet. Create your first project to start counting materials.'} text={search ? 'Try a different project name, client, or location.' : ''} action={search ? undefined : <Link href="/projects/new" className="primary-button" data-testid="button-empty-create"><Plus size={16} /> Create project</Link>} /> : view === 'grid' ? <div className="project-grid">{filtered.map((project) => <ProjectCard key={project.id} project={project} onDuplicate={() => duplicate(project)} onDelete={() => setConfirmId(project.id)} onExport={() => exportPdf(project)} onSaveBackup={() => saveBackup(project)} />)}</div> : <div className="list-table">{filtered.map((project) => <ProjectListRow key={project.id} project={project} onDuplicate={() => duplicate(project)} onDelete={() => setConfirmId(project.id)} onExport={() => exportPdf(project)} onSaveBackup={() => saveBackup(project)} />)}</div>}
    {toast && <div className="toast" role="status" data-testid="status-toast"><Check size={16} /> {toast}</div>}{confirmId && <Confirm title="Delete this project?" text="This permanently removes the project and every material line inside it from this device." onCancel={() => setConfirmId(null)} onConfirm={remove} />}
  </div>;
}

function Stat({ icon, label, value, note }: { icon: ReactNode; label: string; value: number; note: string }) { return <div className="stat-card"><div className="stat-label">{icon}{label}</div><div className="stat-value">{value}</div><div className="stat-note">{note}</div></div>; }
function ProjectCard({ project, onDuplicate, onDelete, onExport, onSaveBackup }: { project: Project; onDuplicate: () => void; onDelete: () => void; onExport: () => void; onSaveBackup: () => void }) { const progress = getProgress(project); return <article className="project-card" data-testid={`card-project-${project.id}`}><div className="card-top"><div><div className="project-name">{project.name}</div><div className="project-meta"><span><Users size={13} /> {project.client || 'No client set'}</span><span><MapPin size={13} /> {project.location || 'No location set'}</span></div></div><span className={`status-pill ${project.status}`}>{projectStatus[project.status]}</span></div><div className="progress-wrap"><div className="progress-line"><span>Items with quantity</span><strong>{progress.complete} / {progress.total} lines</strong></div><div className="progress-track"><div className="progress-fill" style={{ width: `${progress.percent}%` }} /></div></div><div className="card-footer"><span className="updated">{relativeText(project.updatedAt)}</span><div className="card-actions"><Link className="mini-button" href={`/projects/${project.id}`} aria-label={`Open ${project.name}`} data-testid={`link-open-project-${project.id}`}><ChevronRight size={17} /></Link><Link className="mini-button" href={`/projects/${project.id}/edit`} aria-label={`Edit ${project.name}`} data-testid={`link-edit-project-${project.id}`}><Pencil size={15} /></Link><button className="mini-button" onClick={onExport} aria-label={`Export ${project.name} as PDF`} data-testid={`button-export-project-${project.id}`}><Download size={14} /></button><button className="mini-button" onClick={onSaveBackup} aria-label={`Save backup for ${project.name}`} data-testid={`button-save-backup-${project.id}`}><Save size={14} /></button><button className="mini-button" onClick={onDuplicate} aria-label={`Duplicate ${project.name}`} data-testid={`button-duplicate-project-${project.id}`}><Copy size={15} /></button><button className="mini-button delete" onClick={onDelete} aria-label={`Delete ${project.name}`} data-testid={`button-delete-project-${project.id}`}><Trash2 size={15} /></button></div></div></article>; }
function ProjectListRow({ project, onDuplicate, onDelete, onExport, onSaveBackup }: { project: Project; onDuplicate: () => void; onDelete: () => void; onExport: () => void; onSaveBackup: () => void }) { const progress = getProgress(project); return <div className="list-row" data-testid={`row-project-${project.id}`}><div><div className="item-primary">{project.name}</div><div className="item-secondary">{project.client} · {project.location || 'Location not set'}</div></div><span className={`status-pill ${project.status}`}>{projectStatus[project.status]}</span><span className="item-secondary">{progress.complete}/{progress.total} counted</span><span className="item-secondary">{dateText(project.updatedAt)}</span><div className="card-actions"><Link className="mini-button" href={`/projects/${project.id}`} aria-label="Open project"><ChevronRight size={16} /></Link><button className="mini-button" onClick={onExport} aria-label="Export project as PDF"><Download size={14} /></button><button className="mini-button" onClick={onSaveBackup} aria-label="Save project backup"><Save size={14} /></button><button className="mini-button" onClick={onDuplicate} aria-label="Duplicate project"><Copy size={14} /></button><button className="mini-button delete" onClick={onDelete} aria-label="Delete project"><Trash2 size={14} /></button></div></div>; }

function ProjectDetails() {
  const { id } = useParams<{ id: string }>(); const { projects, commit } = useProjects(); const project = projects.find((entry) => entry.id === id); const [toast, setToast] = useState(''); if (!project) return <Missing />; const progress = getProgress(project);
  const updateStatus = (status: ProjectStatus) => { if (!commit(projects.map((entry) => entry.id === id ? { ...entry, status, updatedAt: new Date().toISOString() } : entry))) return; setToast(`Project marked ${projectStatus[status].toLowerCase()}`); window.setTimeout(() => setToast(''), 2200); };
  return <div className="page"><div className="page-head"><div><Link href="/" className="eyebrow" data-testid="link-back-projects"><ArrowLeft size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} /> All projects</Link></div><div className="page-head-actions"><button className="ghost-button" onClick={() => { if (!printProject(project)) setToast('PDF export could not be completed. Try again.'); }} data-testid="button-export-project"><Download size={15} /> Export PDF</button><button className="ghost-button" onClick={() => { if (!tryExportProjectJson(project)) setToast('Backup could not be saved. Try again.'); }} data-testid="button-save-backup-detail"><Save size={15} /> Save Backup</button><Link href={`/projects/${id}/edit`} className="primary-button" data-testid="button-edit-project"><Pencil size={15} /> Edit project</Link></div></div><section className="detail-banner"><div className="eyebrow">Project overview</div><h1 data-testid="text-project-name">{project.name}</h1><p>{project.description || 'No project description added yet.'}</p><div className="banner-grid"><div><div className="banner-label">Client</div><div className="banner-value">{project.client || 'Not set'}</div></div><div><div className="banner-label">Site location</div><div className="banner-value">{project.location || 'Not set'}</div></div><div><div className="banner-label">Last updated</div><div className="banner-value">{dateText(project.updatedAt)}</div></div></div></section><div className="detail-grid"><section className="panel"><h2>Inventory overview</h2><p className="panel-sub">Track each material line directly from the project.</p><div className="big-progress"><div className="ring" style={{ '--progress': `${progress.percent}%` } as React.CSSProperties}><strong>{progress.percent}%</strong></div><div style={{ flex: 1 }}><div className="summary-line"><span>Items with quantity</span><strong>{progress.complete} lines</strong></div><div className="summary-line"><span>Items to update</span><strong>{progress.total - progress.complete} lines</strong></div><div className="progress-track"><div className="progress-fill" style={{ width: `${progress.percent}%` }} /></div></div></div></section><section className="panel"><h2>Project status</h2><p className="panel-sub">Update this as the work moves forward.</p><select value={project.status} onChange={(event) => updateStatus(event.target.value as ProjectStatus)} aria-label="Project status" data-testid="select-project-status"><option value="active">Active</option><option value="on-hold">On hold</option><option value="completed">Completed</option></select><div className="summary-line" style={{ marginTop: 20 }}><span>Created</span><strong>{dateText(project.createdAt)}</strong></div></section></div><div className="section-head" style={{ marginTop: 35 }}><div><div className="section-title">Material lines</div><div className="section-kicker">{progress.total ? `${progress.total} lines tracked` : 'Nothing added yet'}</div></div><Link href={`/projects/${id}/items`} className="ghost-button" data-testid="link-manage-items">Manage inventory <ChevronRight size={15} /></Link></div>{project.items.length ? <div className="detail-items">{project.items.slice(0, 5).map((entry) => <ItemSummary key={entry.id} item={entry} />)}</div> : <Empty title="No items yet" text="Add your first material to start tracking this project's inventory." action={<Link href={`/projects/${id}/items/new`} className="primary-button" data-testid="button-add-first-item"><Plus size={16} /> Add material</Link>} />}{toast && <div className="toast" role="status" data-testid="status-toast">{toast}</div>}</div>;
}

function ItemSummary({ item }: { item: Item }) { return <div className="item-summary">{item.photo ? <img src={item.photo} alt="" className="item-thumb" /> : <div className="item-thumb placeholder"><Package size={16} /></div>}<div className="item-summary-main"><strong>{item.name}</strong><span>{item.quantity} {unitLabel(item.unit)}</span></div><span className="item-secondary">{item.notes || 'No notes'}</span></div>; }

const SORT_OPTIONS = ['Name A-Z', 'Name Z-A', 'Quantity Low-High', 'Quantity High-Low', 'Recently Added'] as const;
type SortOption = typeof SORT_OPTIONS[number];
const FILTER_OPTIONS = ['All', ...UNIT_OPTIONS, 'Custom'] as const;

function ItemList() {
  const { id } = useParams<{ id: string }>(); const { projects, commit } = useProjects(); const project = projects.find((entry) => entry.id === id); const [search, setSearch] = useState(''); const [filter, setFilter] = useState<string>('All'); const [sort, setSort] = useState<SortOption>('Recently Added'); const [confirmId, setConfirmId] = useState<string | null>(null); const [preview, setPreview] = useState<Item | null>(null); const [toast, setToast] = useState('');
  const projectItems = project?.items ?? [];
  const filtered = useMemo(() => {
    const query = search.toLowerCase();
    return projectItems.filter((entry) => `${entry.name} ${entry.unit} ${entry.notes}`.toLowerCase().includes(query)).filter((entry) => filter === 'All' || (filter === 'Custom' ? !isStandardUnit(entry.unit) : entry.unit === filter)).sort((a, b) => sort === 'Name A-Z' ? a.name.localeCompare(b.name) : sort === 'Name Z-A' ? b.name.localeCompare(a.name) : sort === 'Quantity Low-High' ? a.quantity - b.quantity : sort === 'Quantity High-Low' ? b.quantity - a.quantity : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [projectItems, search, filter, sort]);
  if (!project) return <Missing />;
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2200); };
  const mutate = (items: Item[], message: string) => { if (!commit(projects.map((entry) => entry.id === id ? { ...entry, items, updatedAt: new Date().toISOString() } : entry))) return false; notify(message); return true; };
  const countItem = (entry: Item, amount: number) => mutate(project.items.map((current) => current.id === entry.id ? { ...current, quantity: Math.max(0, Number((current.quantity + amount).toFixed(2))), status: current.quantity + amount > 0 ? 'complete' : 'pending', updatedAt: new Date().toISOString() } : current), 'Quantity saved locally');
  const remove = () => { if (!confirmId) return; if (!mutate(project.items.filter((entry) => entry.id !== confirmId), 'Material deleted')) return; setConfirmId(null); };
   return <div className="page"><div className="page-head"><div><Link href={`/projects/${id}`} className="eyebrow" data-testid="link-back-overview"><ArrowLeft size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} /> {project.name}</Link><h1 className="page-title">Material lines</h1><p className="page-lede">Search, filter, sort, and count every material stored for this project.</p></div><div className="page-head-actions"><Link href={`/projects/${id}/items/new`} className="primary-button" data-testid="button-add-item"><Plus size={16} /> Add material</Link></div></div><div className="toolbar item-toolbar"><label className="search-box"><Search size={16} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, unit, or notes..." aria-label="Search items" data-testid="input-search-items" /></label><label className="select-control"><SlidersHorizontal size={15} /><select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter items" data-testid="select-item-filter"><option value="All">All units</option>{FILTER_OPTIONS.slice(1).map((option) => <option key={option} value={option}>{option}</option>)}</select></label><label className="select-control"><select value={sort} onChange={(event) => setSort(event.target.value as SortOption)} aria-label="Sort items" data-testid="select-item-sort">{SORT_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select></label><span className="section-kicker">{filtered.length} of {project.items.length} lines</span></div>{filtered.length ? <div className="item-table"><div className="item-table-head"><span>Material</span><span>Quantity</span><span>Unit</span><span>Actions</span></div>{filtered.map((entry) => <div className="item-row" key={entry.id} data-testid={`row-item-${entry.id}`}><button className="item-identity" onClick={() => entry.photo && setPreview(entry)} aria-label={entry.photo ? `Preview photo for ${entry.name}` : entry.name}>{entry.photo ? <img src={entry.photo} alt="" className="item-thumb" /> : <div className="item-thumb placeholder"><Package size={16} /></div>}<span><strong>{entry.name}</strong><small>{entry.notes || 'No notes added'}</small></span></button><div className="count-control"><button className="mini-button" onClick={() => countItem(entry, -1)} aria-label={`Decrease ${entry.name}`} data-testid={`button-decrease-${entry.id}`}><span style={{ fontSize: 18 }}>−</span></button><strong data-testid={`text-quantity-${entry.id}`}>{entry.quantity}</strong><button className="mini-button" onClick={() => countItem(entry, 1)} aria-label={`Increase ${entry.name}`} data-testid={`button-increase-${entry.id}`}><Plus size={15} /></button></div><span className="unit-display">{unitLabel(entry.unit)}</span><div className="card-actions"><button className="mini-button" onClick={() => entry.photo && setPreview(entry)} disabled={!entry.photo} aria-label={`Preview ${entry.name}`}><ImagePlus size={14} /></button><Link className="mini-button" href={`/projects/${id}/items/new?edit=${entry.id}`} aria-label={`Edit ${entry.name}`} data-testid={`link-edit-item-${entry.id}`}><Pencil size={14} /></Link><button className="mini-button delete" onClick={() => setConfirmId(entry.id)} aria-label={`Delete ${entry.name}`} data-testid={`button-delete-item-${entry.id}`}><Trash2 size={14} /></button></div></div>)}</div> : <Empty title={search || filter !== 'All' ? 'No matching items found.' : 'No items added yet. Click + Add Item to begin.'} text={search || filter !== 'All' ? 'Try a different search or adjust the unit filter.' : ''} action={search || filter !== 'All' ? undefined : <Link href={`/projects/${id}/items/new`} className="primary-button" data-testid="button-empty-add-item"><Plus size={16} /> Add Item</Link>} />}{toast && <div className="toast" role="status" data-testid="status-count-toast"><Check size={16} /> {toast}</div>}{confirmId && <Confirm title="Delete this material?" text="This line will be removed from the project count sheet." onCancel={() => setConfirmId(null)} onConfirm={remove} />}{preview && <PhotoPreview item={preview} onClose={() => setPreview(null)} />}</div>;
}

function ProjectForm() {
  const { id } = useParams<{ id: string }>(); const editing = Boolean(id); const { projects, commit } = useProjects(); const existing = projects.find((entry) => entry.id === id); const [, setLocation] = useLocation(); const [values, setValues] = useState({ name: existing?.name ?? '', client: existing?.client ?? '', location: existing?.location ?? '', description: existing?.description ?? '', notes: existing?.notes ?? '', status: existing?.status ?? 'active' as ProjectStatus }); const [error, setError] = useState(''); if (editing && !existing) return <Missing />;
  const update = (key: string, value: string) => { setError(''); setValues((current) => ({ ...current, [key]: value })); };
  const submit = (event: FormEvent) => { event.preventDefault(); if (!values.name.trim()) { setError('Project name is required.'); return; } const stamp = new Date().toISOString(); if (existing) { if (commit(projects.map((entry) => entry.id === id ? { ...entry, ...values, name: values.name.trim(), updatedAt: stamp } : entry))) setLocation(`/projects/${id}`); } else { const project = createProject({ ...values, name: values.name.trim() }); if (commit([project, ...projects])) setLocation(`/projects/${project.id}`); } };
  return <div className="page"><div className="form-shell"><Link href={editing ? `/projects/${id}` : '/'} className="eyebrow" data-testid="link-cancel-project"><ArrowLeft size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} /> Cancel</Link><h1 className="page-title">{editing ? 'Edit project' : 'Create a project'}</h1><p className="page-lede">{editing ? 'Keep the project record current for everyone working from this device.' : 'Set up a clear home for the materials you need to track.'}</p><form className="form-card" onSubmit={submit}><div className="form-grid"><Field label="Project name" required value={values.name} onChange={(value) => update('name', value)} placeholder="e.g. Northline Lobby Renovation" testId="input-project-name" /><Field label="Client" value={values.client} onChange={(value) => update('client', value)} placeholder="Company or contact" testId="input-project-client" /><Field label="Site location" value={values.location} onChange={(value) => update('location', value)} placeholder="Address or site reference" testId="input-project-location" /><div className="field"><label htmlFor="project-status">Status</label><select id="project-status" value={values.status} onChange={(event) => update('status', event.target.value)} data-testid="select-project-form-status"><option value="active">Active</option><option value="on-hold">On hold</option><option value="completed">Completed</option></select></div><Field full label="Description" value={values.description} onChange={(value) => update('description', value)} placeholder="What is this project about? Add a useful note for future counts." textarea testId="input-project-description" /><Field full label="Notes" value={values.notes} onChange={(value) => update('notes', value)} placeholder="Optional notes for this project report" textarea testId="input-project-notes" /></div>{error && <p style={{ color: 'hsl(var(--destructive))', fontSize: 12 }} role="alert">{error}</p>}<div className="form-actions"><Link href={editing ? `/projects/${id}` : '/'} className="ghost-button" data-testid="button-cancel-project">Cancel</Link><button className="primary-button" type="submit" data-testid="button-save-project"><Check size={16} /> {editing ? 'Save changes' : 'Create project'}</button></div></form></div></div>;
}

function resizePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('Could not read this image.')); reader.onload = () => { const image = new Image(); image.onload = () => { const scale = Math.min(1, 1000 / Math.max(image.width, image.height)); const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale)); const context = canvas.getContext('2d'); if (!context) return reject(new Error('Could not prepare this image.')); context.drawImage(image, 0, 0, canvas.width, canvas.height); resolve(canvas.toDataURL('image/jpeg', .82)); }; image.onerror = () => reject(new Error('Could not decode this image.')); image.src = String(reader.result); }; reader.readAsDataURL(file); });
}

function ItemForm() {
  const { id } = useParams<{ id: string }>(); const { projects, commit } = useProjects(); const project = projects.find((entry) => entry.id === id); const [, setLocation] = useLocation(); const editId = new URLSearchParams(window.location.search).get('edit'); const existing = project?.items.find((entry) => entry.id === editId); const [values, setValues] = useState({ name: existing?.name ?? '', quantity: String(existing?.quantity ?? ''), unit: existing && !isStandardUnit(existing.unit) ? 'Custom Unit' : existing?.unit ?? 'Piece', customUnit: existing && !isStandardUnit(existing.unit) ? existing.unit : '', notes: existing?.notes ?? '', photo: existing?.photo ?? '' }); const [error, setError] = useState(''); const [photoBusy, setPhotoBusy] = useState(false); if (!project) return <Missing />;
  const update = (key: string, value: string) => { setError(''); setValues((current) => ({ ...current, [key]: value })); };
  const handlePhoto = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Choose a valid image file.'); return; }
    if (file.size > 12 * 1024 * 1024) { setError('That image is too large. Choose an image under 12 MB.'); return; }
    setPhotoBusy(true);
    try { update('photo', await resizePhoto(file)); }
    catch { setError('That photo could not be read. Choose a different image file.'); }
    finally { setPhotoBusy(false); }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const quantityText = values.quantity.trim();
    const quantity = Number(quantityText);
    const unit = values.unit === 'Custom Unit' ? values.customUnit.trim() : values.unit;
    if (!values.name.trim()) { setError('Item name is required.'); return; }
    if (!quantityText || !Number.isFinite(quantity) || quantity < 0) { setError('Enter a valid quantity of zero or more.'); return; }
    if (!unit) { setError('Choose or enter a unit.'); return; }
    const payload = { name: values.name.trim(), quantity: Number(quantity.toFixed(2)), unit, notes: values.notes.trim(), photo: values.photo || undefined };
    const stamp = new Date().toISOString();
    const items = existing ? project.items.map((entry) => entry.id === existing.id ? { ...entry, ...payload, updatedAt: stamp, status: payload.quantity > 0 ? 'complete' as const : 'pending' as const } : entry) : [...project.items, createItem(payload)];
    if (commit(projects.map((entry) => entry.id === id ? { ...entry, items, updatedAt: stamp } : entry))) setLocation(`/projects/${id}/items`);
  };
  return <div className="page"><div className="form-shell"><Link href={`/projects/${id}/items`} className="eyebrow" data-testid="link-cancel-item"><ArrowLeft size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} /> Material lines</Link><h1 className="page-title">{existing ? 'Edit material' : 'Add a material'}</h1><p className="page-lede">{existing ? 'Replace its photo or adjust details without losing the saved quantity.' : `Add a material line to ${project.name}.`}</p><form className="form-card" onSubmit={submit}><div className="form-grid"><Field full label="Item name" required value={values.name} onChange={(value) => update('name', value)} placeholder="e.g. 5/8 inch Type X drywall" testId="input-item-name" /><div className="field full"><label htmlFor="item-photo">Optional photo</label><div className="photo-picker">{values.photo ? <div className="photo-preview"><img src={values.photo} alt="Selected material preview" /><div><strong>{photoBusy ? 'Preparing photo…' : existing ? 'Photo attached' : 'Photo ready'}</strong><span>Replace or remove this image.</span></div><button type="button" className="ghost-button compact" onClick={() => update('photo', '')} data-testid="button-remove-photo"><Trash2 size={14} /> Remove</button></div> : <label className="upload-drop" htmlFor="item-photo"><ImagePlus size={22} /><span><strong>{photoBusy ? 'Preparing photo…' : 'Add a photo'}</strong><small>Choose an image from your device</small></span></label>}<input id="item-photo" type="file" accept="image/*" capture="environment" onChange={(event) => void handlePhoto(event.target.files?.[0])} hidden data-testid="input-item-photo" />{values.photo && <label className="ghost-button compact replace-photo" htmlFor="item-photo"><ImagePlus size={14} /> Replace photo</label>}</div></div><Field label="Quantity" required type="number" value={values.quantity} onChange={(value) => update('quantity', value)} placeholder="0.00" testId="input-item-quantity" /><div className="field"><label htmlFor="item-unit">Unit <span>Required</span></label><select id="item-unit" value={values.unit} onChange={(event) => update('unit', event.target.value)} data-testid="select-item-unit">{UNIT_OPTIONS.map((unit) => <option key={unit}>{unit}</option>)}<option>Custom Unit</option></select>{values.unit === 'Custom Unit' && <input className="custom-unit-input" value={values.customUnit} onChange={(event) => update('customUnit', event.target.value)} placeholder="e.g. sheet, bundle" aria-label="Custom unit" data-testid="input-custom-unit" />}</div><Field full label="Notes" value={values.notes} onChange={(value) => update('notes', value)} placeholder="Optional context for the next count" textarea testId="input-item-notes" /></div>{error && <p style={{ color: 'hsl(var(--destructive))', fontSize: 12 }} role="alert" data-testid="status-item-error">{error}</p>}<div className="form-actions"><Link href={`/projects/${id}/items`} className="ghost-button" data-testid="button-cancel-item">Cancel</Link><button className="primary-button" type="submit" disabled={photoBusy} data-testid="button-save-item"><Check size={16} /> {existing ? 'Save material' : 'Add material'}</button></div></form></div></div>;
}

function Field({ label, value, onChange, placeholder, required, textarea, full, type = 'text', testId }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; required?: boolean; textarea?: boolean; full?: boolean; type?: string; testId: string }) { return <div className={cx('field', full && 'full')}><label htmlFor={testId}>{label} {required && <span>Required</span>}</label>{textarea ? <textarea id={testId} aria-required={required || undefined} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} data-testid={testId} /> : <input id={testId} aria-required={required || undefined} type={type} step={type === 'number' ? '0.01' : undefined} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} data-testid={testId} />}</div>; }
function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) { return <div className="empty-state"><div className="empty-icon"><ClipboardList size={22} /></div><h3>{title}</h3><p>{text}</p>{action}</div>; }
function Confirm({ title, text, onCancel, onConfirm }: { title: string; text: string; onCancel: () => void; onConfirm: () => void }) { return <div className="confirm-backdrop"><div className="confirm-card" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><button className="icon-button" style={{ float: 'right' }} onClick={onCancel} aria-label="Close confirmation"><X size={16} /></button><h2 id="confirm-title">{title}</h2><p>{text}</p><div className="confirm-actions"><button className="ghost-button" onClick={onCancel}>Keep it</button><button className="danger-button" onClick={onConfirm}><Trash2 size={15} /> Delete</button></div></div></div>; }
function PhotoPreview({ item, onClose }: { item: Item; onClose: () => void }) { return <div className="confirm-backdrop photo-modal" onClick={onClose}><div className="photo-modal-card" role="dialog" aria-modal="true" aria-label={`Photo preview for ${item.name}`} onClick={(event) => event.stopPropagation()}><button className="icon-button photo-close" onClick={onClose} aria-label="Close photo preview"><X size={17} /></button><img src={item.photo} alt={item.name} /><div><strong>{item.name}</strong><span>{item.quantity} {unitLabel(item.unit)}</span></div></div></div>; }
function Missing() { return <div className="page"><Empty title="Project not found" text="This record may have been removed from local storage." action={<Link href="/" className="primary-button">Return to projects</Link>} /></div>; }
function NotFound() { return <div className="page"><Empty title="Page not found" text="That workspace view does not exist." action={<Link href="/" className="primary-button">Back to overview</Link>} /></div>; }

export default App;