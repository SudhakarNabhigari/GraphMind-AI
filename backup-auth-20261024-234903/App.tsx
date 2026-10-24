import { useState, useMemo, useRef, useEffect, type ChangeEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Bell, BookOpen, Check, CheckCircle2,
  ChevronDown, ChevronLeft, ChevronRight, Clock3, Command, Copy, FileSearch, FileText,
  Files, Filter, GitBranch, HelpCircle, History, Home, Layers3, LogOut, Menu, MessageSquareText,
  MoreHorizontal, Network, PanelLeftClose, Plus, Search, Send, Settings2, ShieldCheck,
  Sparkles, ThumbsDown, ThumbsUp, Trash2, UploadCloud, X, Zap,
} from 'lucide-react';
import {
  useRequestUploadUrl, useListDocuments, useRegisterDocument, useDeleteDocument,
  useProcessDocument, useGetDashboardStats, useAskKnowledgeBase, useListQuestionHistory, useGetDocument,
  useGetHistoryItem, useDeleteHistoryItem, useSubmitAnswerFeedback, useGetKnowledgeGraph,
  useListSources, useGetAnalytics, useSearchKnowledgeBase, useGetDocumentPage,
  useGetConcept, useGetRelationship, getListDocumentsQueryKey, getGetDashboardStatsQueryKey,
  getListQuestionHistoryQueryKey, getGetKnowledgeGraphQueryKey, getListSourcesQueryKey,
  getGetAnalyticsQueryKey, getSearchKnowledgeBaseQueryKey, getGetHistoryItemQueryKey,
  getGetDocumentQueryKey, getGetDocumentPageQueryKey, getGetConceptQueryKey,
  getGetRelationshipQueryKey,
} from '@workspace/api-client-react';
import type { Document, EvidenceSource, HistoryItem, Relationship, GraphNode } from '@workspace/api-client-react';
import { useAuth } from '@workspace/replit-auth-web';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { GraphFlow } from '@/components/graph-flow';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import './app.css';
import './app-pages.css';
import './feature.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

const navItems = [
  { href: '/', label: 'Dashboard', icon: Home },
  { href: '/knowledge', label: 'Knowledge Base', icon: UploadCloud },
  { href: '/chat', label: 'Chat & Q&A', icon: MessageSquareText },
  { href: '/graph', label: 'Knowledge Graph', icon: Network },
  { href: '/sources', label: 'Sources & citations', icon: FileSearch },
  { href: '/analytics', label: 'Analytics', icon: Activity },
  { href: '/history', label: 'History', icon: History },
];

function Button({ children, onClick, variant = 'secondary', className = '', disabled, type = 'button', ...props }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  className?: string; disabled?: boolean; type?: 'button' | 'submit';
  'aria-label'?: string; 'data-testid'?: string;
}) {
  return <button type={type} onClick={onClick} disabled={disabled} className={`button button-${variant} ${className}`} {...props}>{children}</button>;
}
function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`glass panel ${className}`}>{children}</section>;
}
function Header({ eyebrow, title, subtitle, action }: { eyebrow?: string; title: ReactNode; subtitle?: string; action?: ReactNode }) {
  return <div className="page-header"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action}</div>;
}
function LoadingRows() { return <div className="skeleton-list" aria-label="Loading"><span/><span/><span/></div>; }
function QueryError({ retry }: { retry: () => void }) { return <div className="state-box"><div className="state-icon"><Activity size={19}/></div><strong>We couldn’t load this view</strong><span>Check your connection and try again.</span><Button onClick={retry}>Try again</Button></div>; }
function Empty({ icon: Icon = Files, title, detail, action }: { icon?: typeof Files; title: string; detail: string; action?: ReactNode }) {
  return <div className="state-box"><div className="state-icon"><Icon size={21}/></div><strong>{title}</strong><span>{detail}</span>{action}</div>;
}
function StatusPill({ status }: { status: string }) {
  return <span className={`status status-${status}`}>{status === 'processed' && <CheckCircle2 size={12}/>}<span>{status}</span></span>;
}
function fmtDate(date?: string | null) {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(date));
}
function fmtSize(bytes: number) { return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`; }
function sourceHref(source: EvidenceSource, historyId?: string) {
  const params = new URLSearchParams();
  if (historyId) params.set('historyId', historyId);
  else params.set('documentId', source.documentId);
  params.set('sourceId', source.id);
  params.set('pageNumber', String(source.pageNumber));
  return `/sources?${params.toString()}`;
}
function pageHref(documentId: string, pageNumber: number) {
  const params = new URLSearchParams({ documentId, pageNumber: String(pageNumber) });
  return `/sources?${params.toString()}`;
}

function AppFrame() {
  const auth = useAuth();
  const [path] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const searchParams = useMemo(() => ({ query: search.trim() }), [search]);
  const searchQuery = useSearchKnowledgeBase(searchParams, { query: { enabled: search.trim().length > 0, queryKey: getSearchKnowledgeBaseQueryKey(searchParams) } });

  if (auth.isLoading) return <div className="auth-loading"><div className="brand-mark"><Network size={22}/></div><div className="skeleton-line"/></div>;
  if (!auth.isAuthenticated) return <SignIn onLogin={auth.login}/>;

  return <div className="app-shell ambient">
    <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
      <Link href="/" className="brand" onClick={() => setMobileOpen(false)}>
        <div className="brand-mark"><Network size={22}/><i/><b/></div><span><strong>GraphMind <em>AI</em></strong><small>Documents to connected knowledge</small></span>
      </Link>
      <div className="workspace-label">WORKSPACE <button aria-label="Workspace settings" data-testid="button-workspace-settings"><Settings2 size={14}/></button></div>
      <nav className="side-nav" aria-label="Main navigation">
        {navItems.map(({ href, label, icon: Icon }) => <Link key={href} href={href} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`} className={`nav-link ${path === href ? 'active' : ''}`} onClick={() => setMobileOpen(false)}><Icon size={17}/><span>{label}</span>{href === '/knowledge' && <span className="nav-add"><Plus size={13}/></span>}</Link>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="privacy-card"><div className="privacy-icon"><ShieldCheck size={16}/></div><div><strong>Your knowledge stays yours</strong><span>Private by default. Always.</span></div></div>
        <button className="profile-row" onClick={() => auth.logout()} data-testid="button-account-logout"><div className="avatar">{(auth.user?.firstName?.[0] || auth.user?.email?.[0] || 'G').toUpperCase()}</div><span className="profile-copy"><strong>{auth.user?.firstName || auth.user?.email || 'Your workspace'}</strong><small>Personal workspace</small></span><LogOut size={15} className="logout-icon"/></button>
      </div>
    </aside>
    <div className="main-area">
      <header className="topbar">
        <button className="mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(!mobileOpen)} data-testid="button-mobile-menu">{mobileOpen ? <X size={20}/> : <Menu size={20}/>}</button>
        <div className="breadcrumbs"><span>Workspace</span><ChevronRight size={13}/><strong>{navItems.find((n) => n.href === path)?.label || 'Dashboard'}</strong></div>
        <div className="top-search-wrap">
          <label className="top-search"><Search size={16}/><input aria-label="Search workspace" placeholder="Search documents, concepts, questions…" value={search} onFocus={() => setShowSearch(true)} onChange={(e) => { setSearch(e.target.value); setShowSearch(true); }} data-testid="input-global-search"/><kbd><Command size={11}/> K</kbd></label>
          {showSearch && search && <div className="search-popover">
            {searchQuery.isLoading ? <LoadingRows/> : searchQuery.isError ? <div className="search-empty">Search is unavailable right now.</div> : searchQuery.data ? <>
              {searchQuery.data.documents.map(d => <Link key={d.id} href="/knowledge" className="search-result" onClick={() => setShowSearch(false)}><FileText size={15}/><span>{d.name}<small>Document</small></span></Link>)}
              {searchQuery.data.concepts.map(c => <Link key={c.id} href="/graph" className="search-result" onClick={() => setShowSearch(false)}><Network size={15}/><span>{c.label}<small>Concept</small></span></Link>)}
              {searchQuery.data.questions.map(q => <Link key={q.id} href="/history" className="search-result" onClick={() => setShowSearch(false)}><MessageSquareText size={15}/><span>{q.question}<small>Saved answer</small></span></Link>)}
              {searchQuery.data.sources.map(s => <Link key={s.id} href="/sources" className="search-result" onClick={() => setShowSearch(false)}><FileSearch size={15}/><span>{s.documentName}<small>Page {s.pageNumber} evidence</small></span></Link>)}
              {!searchQuery.data.documents.length && !searchQuery.data.concepts.length && !searchQuery.data.questions.length && !searchQuery.data.sources.length && <div className="search-empty">No matches in your knowledge base.</div>}
            </> : null}<button className="search-close" onClick={() => setShowSearch(false)}>Close search <X size={12}/></button>
          </div>}
        </div>
        <div className="top-actions"><button className="icon-button" aria-label="Notifications" data-testid="button-notifications"><Bell size={17}/><i className="notification-dot"/></button><div className="top-avatar">{(auth.user?.firstName?.[0] || auth.user?.email?.[0] || 'G').toUpperCase()}</div></div>
      </header>
      <main className="content" onClick={() => showSearch && setShowSearch(false)}>
        <Switch>
          <Route path="/" component={Dashboard}/>
          <Route path="/knowledge" component={Knowledge}/>
          <Route path="/chat" component={Chat}/>
          <Route path="/graph" component={Graph}/>
          <Route path="/sources" component={Sources}/>
          <Route path="/analytics" component={Analytics}/>
          <Route path="/history" component={HistoryPage}/>
          <Route component={NotFound}/>
        </Switch>
      </main>
      <footer className="footer"><span>GraphMind AI</span><span>Grounded in your documents</span><span><span className="live-dot"/> Systems operational</span></footer>
    </div>
    {mobileOpen && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)}/>}
  </div>;
}

function SignIn({ onLogin }: { onLogin: () => void }) {
  return (
    <main className="signin-screen signin-reference">
      <div className="reference-aurora reference-aurora-a" />
      <div className="reference-aurora reference-aurora-b" />
      <div className="reference-stars" />

      <header className="reference-header">
        <div className="reference-brand">
          <span className="reference-brand-icon"><Network size={30} /></span>
          <span>GraphMind <b>AI</b></span>
        </div>
        <div className="reference-header-links">
          <span>DOCUMENT</span><i />
          <span>INTELLIGENCE</span><i />
          <span>CONNECTED</span><i />
          <span>KNOWLEDGE</span>
          <b />
        </div>
      </header>

      <section className="reference-main">
        <div className="reference-story">
          <div className="reference-eyebrow">DOCUMENT INTELLIGENCE</div>
          <h1>Your knowledge,<br /><span>connected.</span></h1>
          <p className="reference-description">
            Bring your research together. Ask questions, follow evidence,
            and see how ideas connect across every document.
          </p>

          <div className="reference-benefits">
            <div className="reference-benefit">
              <span className="reference-benefit-icon blue"><ShieldCheck size={28} /></span>
              <span><b>Private by default</b><small>Your documents are only yours.</small></span>
            </div>
            <div className="reference-benefit">
              <span className="reference-benefit-icon purple"><FileSearch size={28} /></span>
              <span><b>Evidence-backed answers</b><small>Verify the page behind the insight.</small></span>
            </div>
            <div className="reference-benefit">
              <span className="reference-benefit-icon violet"><GitBranch size={28} /></span>
              <span><b>Ideas in context</b><small>Explore supported relationships.</small></span>
            </div>
          </div>

          <div className="reference-books" aria-hidden="true">
            <div className="reference-book book-one">KNOWLEDGE</div>
            <div className="reference-book book-two">INSIGHTS</div>
            <div className="reference-book book-three">CONNECTIONS</div>
          </div>
        </div>

        <div className="reference-graph" aria-hidden="true">
          <div className="reference-orbit orbit-one" />
          <div className="reference-orbit orbit-two" />
          <div className="reference-orbit orbit-three" />

          <svg className="reference-graph-lines" viewBox="0 0 520 610" fill="none">
            <defs>
              <linearGradient id="referenceLine" x1="0" y1="0" x2="1" y2="1">
                <stop stopColor="#9A48FF" />
                <stop offset=".5" stopColor="#258BFF" />
                <stop offset="1" stopColor="#28F0E0" />
              </linearGradient>
            </defs>
            <g stroke="url(#referenceLine)" strokeWidth="1.5">
              <path d="M260 300 L105 145 L60 255 L120 420 L260 300 L400 165 L460 300 L390 440 L260 300" />
              <path d="M105 145 L205 85 L260 300 L320 80 L400 165" />
              <path d="M120 420 L200 510 L260 300 L330 515 L390 440" />
              <path d="M60 255 L30 350 L120 420 M460 300 L490 365 L390 440" />
              <path d="M205 85 L320 80 M200 510 L330 515" strokeDasharray="5 8" />
            </g>
            <g fill="#0D1538" strokeWidth="2">
              <circle cx="105" cy="145" r="10" stroke="#23D9FF" />
              <circle cx="400" cy="165" r="11" stroke="#A26AFF" />
              <circle cx="120" cy="420" r="9" stroke="#23D9FF" />
              <circle cx="390" cy="440" r="10" stroke="#A26AFF" />
            </g>
            <g className="reference-graph-dots">
              <circle cx="205" cy="85" r="6" fill="#28E5FF" />
              <circle cx="320" cy="80" r="6" fill="#AA77FF" />
              <circle cx="60" cy="255" r="7" fill="#28E5FF" />
              <circle cx="460" cy="300" r="7" fill="#AA77FF" />
              <circle cx="200" cy="510" r="6" fill="#28E5FF" />
              <circle cx="330" cy="515" r="6" fill="#AA77FF" />
              <circle cx="30" cy="350" r="5" fill="#28E5FF" />
              <circle cx="490" cy="365" r="5" fill="#28E5FF" />
            </g>
          </svg>

          <div className="reference-core">
            <div className="reference-core-inner"><Network size={62} /></div>
          </div>

          <div className="reference-doc doc-one"><FileText size={24} /><b>Notes</b><small>Ideas & research</small></div>
          <div className="reference-doc doc-two"><FileText size={24} /><b>Research Papers</b><small>Connected concepts</small></div>
          <div className="reference-doc doc-three"><FileText size={24} /><b>Reports</b><small>New insights</small></div>
          <div className="reference-doc doc-four"><FileText size={24} /><b>Articles</b><small>Source library</small></div>
          <div className="reference-doc doc-five"><FileText size={24} /><b>Documents</b><small>Evidence mapped</small></div>

          <div className="reference-graph-caption"><i /> KNOWLEDGE GRAPH <span>LIVE CONNECTIONS</span></div>
        </div>

        <aside className="reference-login-wrap">
          <div className="reference-login">
            <div className="reference-login-logo"><Network size={35} /></div>
            <div className="reference-login-brand">GraphMind <b>AI</b></div>
            <h2>Welcome back</h2>
            <p className="reference-login-subtitle">Sign in to your workspace</p>

            <div className="reference-login-illustration">
              <span><FileText size={19} /></span><i />
              <span className="middle"><Network size={20} /></span><i />
              <span><Sparkles size={19} /></span>
            </div>

            <div className="reference-login-features">
              <div><ShieldCheck size={17} /><span><b>Private by default</b><small>Your documents stay in your workspace</small></span><Check size={16} /></div>
              <div><FileSearch size={17} /><span><b>Evidence-backed answers</b><small>Trace insights back to their sources</small></span><Check size={16} /></div>
              <div><GitBranch size={17} /><span><b>Connected intelligence</b><small>Discover relationships across documents</small></span><Check size={16} /></div>
            </div>

            <Button variant="primary" onClick={onLogin} className="signin-button reference-login-button" data-testid="button-sign-in">
              Sign in to your workspace <ArrowRight size={19} />
            </Button>

            <div className="reference-login-divider"><span />SECURE ACCESS<span /></div>
            <div className="reference-login-footer"><ShieldCheck size={16} /> Secure sign-in <i /> Your data stays private</div>
          </div>
        </aside>
      </section>

      <footer className="reference-footer">GRAPHMIND <span>•</span> CONNECTED KNOWLEDGE</footer>
    </main>
  );
}
function Dashboard() {
  const auth = useAuth();
  const docs = useListDocuments();
  const stats = useGetDashboardStats();
  const history = useListQuestionHistory();
  const graph = useGetKnowledgeGraph(undefined, { query: { queryKey: getGetKnowledgeGraphQueryKey() } });
  const busy = docs.isLoading || stats.isLoading;
  const retry = () => { void docs.refetch(); void stats.refetch(); };
  const statItems = [
    { label: 'Documents uploaded', value: stats.data?.documentsUploaded, icon: Files, color: 'violet', foot: `${stats.data?.processedDocuments ?? 0} processed` },
    { label: 'Questions asked', value: stats.data?.questionsAsked, icon: MessageSquareText, color: 'blue', foot: 'Across your workspace' },
    { label: 'Concepts extracted', value: stats.data?.conceptsExtracted, icon: Sparkles, color: 'mint', foot: 'From processed PDFs' },
    { label: 'Connections found', value: stats.data?.connectionsFound, icon: GitBranch, color: 'gold', foot: 'Evidence-backed' },
  ];
  return <div className="page-stack fade-up">
    <Header eyebrow="YOUR RESEARCH DESK" title={<>Welcome back, {auth.user?.firstName || 'researcher'}<span className="title-dot">.</span></>} subtitle="Your documents are ready to think with. What are you exploring today?" action={<Link href="/knowledge" className="button button-primary" data-testid="link-upload-top"><Plus size={16}/> Add documents</Link>}/>
    {stats.isError || docs.isError ? <QueryError retry={retry}/> : <>
      <div className="stats-grid">{statItems.map(({ label, value, icon: Icon, color, foot }) => <Panel key={label} className={`stat-card stat-${color}`}><div className="stat-top"><span>{label}</span><span className={`stat-icon ${color}`}><Icon size={18}/></span></div><strong>{busy ? <i className="number-skeleton"/> : value ?? '—'}</strong><small><span className="stat-bullet"/> {foot}</small></Panel>)}</div>
      <div className="dashboard-main">
        <Panel className="documents-panel"><div className="panel-heading"><div><span className="eyebrow">LIBRARY</span><h2>Recent documents</h2></div><Link href="/knowledge" className="text-link">View library <ArrowRight size={14}/></Link></div>
          {docs.isLoading ? <LoadingRows/> : docs.data?.length ? <div className="recent-docs">{docs.data.slice(0,5).map(d => <DocumentRow key={d.id} doc={d}/>)}</div> : <Empty icon={Files} title="Start with a source" detail="Upload a PDF to build your private knowledge base." action={<Link href="/knowledge" className="button button-primary"><UploadCloud size={15}/> Upload a PDF</Link>}/>}
        </Panel>
        <GraphPreview graph={graph.data} loading={graph.isLoading} error={graph.isError} retry={() => void graph.refetch()}/>
      </div>
      <div className="dashboard-lower">
        <Panel className="insight-panel"><div className="panel-heading"><div><span className="eyebrow">AT A GLANCE</span><h2>Your knowledge footprint</h2></div><Link href="/analytics" className="text-link">Analytics <ArrowRight size={14}/></Link></div>
          {stats.data && (stats.data.documentsUploaded || stats.data.questionsAsked || stats.data.conceptsExtracted) ? <MiniInsight stats={stats.data}/> : <div className="insight-empty"><div className="insight-mark"><Activity size={21}/></div><div><strong>Insights take shape as you explore</strong><span>Upload documents and ask questions to see activity here.</span></div></div>}
        </Panel>
        <Panel className="questions-panel"><div className="panel-heading"><div><span className="eyebrow">RECENT EXPLORATIONS</span><h2>Recent questions</h2></div><Link href="/history" className="text-link">View history <ArrowRight size={14}/></Link></div>
          {history.isLoading ? <LoadingRows/> : history.isError ? <div className="inline-error">Question history is unavailable.</div> : history.data?.length ? <div className="recent-questions">{history.data.slice(0,3).map(q => <Link href="/history" key={q.id} className="question-row"><span className="question-mark"><MessageSquareText size={14}/></span><span><strong>{q.question}</strong><small>{fmtDate(q.createdAt)} · {q.mode === 'ai' ? 'Live AI' : 'Demo search'}</small></span><ChevronRight size={14}/></Link>)}</div> : <div className="mini-empty">Your saved answers will appear here.</div>}
        </Panel>
        <Panel className="actions-panel"><div className="panel-heading"><div><span className="eyebrow">SHORTCUTS</span><h2>Quick actions</h2></div></div><div className="action-grid">
          <Link href="/chat" className="action-tile"><span className="tile-icon blue"><MessageSquareText size={17}/></span><b>Ask a question</b><small>Find answers in your PDFs</small><ArrowRight size={14}/></Link>
          <Link href="/graph" className="action-tile"><span className="tile-icon mint"><Network size={17}/></span><b>Explore concepts</b><small>Trace connected ideas</small><ArrowRight size={14}/></Link>
          <Link href="/sources" className="action-tile"><span className="tile-icon gold"><FileSearch size={17}/></span><b>Verify evidence</b><small>Review cited passages</small><ArrowRight size={14}/></Link>
          <Link href="/analytics" className="action-tile"><span className="tile-icon violet"><Activity size={17}/></span><b>View activity</b><small>See stored usage trends</small><ArrowRight size={14}/></Link>
        </div></Panel>
      </div>
    </>}
  </div>;
}
function MiniInsight({ stats }: { stats: { documentsUploaded: number; questionsAsked: number; conceptsExtracted: number; connectionsFound: number } }) {
  const vals = [stats.documentsUploaded, stats.questionsAsked, stats.conceptsExtracted, stats.connectionsFound];
  const max = Math.max(...vals, 1);
  return <div className="mini-chart"><div className="mini-chart-body">{vals.map((v, i) => <div className="mini-bar-group" key={i}><div className="mini-bar" style={{height:`${Math.max(4, v/max*100)}%`}}/><span>{['PDFs','Questions','Concepts','Links'][i]}</span></div>)}</div><div className="chart-summary"><span><i className="legend-dot violet"/>Documents</span><span><i className="legend-dot blue"/>Questions</span><span><i className="legend-dot mint"/>Concepts</span></div></div>;
}
function DocumentRow({ doc }: { doc: Document }) {
  return <div className="doc-row"><div className="pdf-icon"><FileText size={17}/><small>PDF</small></div><div className="doc-info"><strong>{doc.name}</strong><small>{fmtSize(doc.sizeBytes)}{doc.pageCount ? ` · ${doc.pageCount} pages` : ''}</small></div><StatusPill status={doc.status}/><span className="doc-date">{fmtDate(doc.processedAt || doc.uploadedAt)}</span><Link href="/knowledge" aria-label={`Open ${doc.name}`} className="row-open"><ArrowRight size={14}/></Link></div>;
}
function GraphPreview({ graph, loading, error, retry }: { graph?: { nodes: GraphNode[]; edges: Relationship[]; isExample: boolean }; loading: boolean; error: boolean; retry: () => void }) {
  return <Panel className="graph-preview"><div className="panel-heading"><div><span className="eyebrow">CONNECTED KNOWLEDGE</span><h2>Knowledge graph</h2></div><Link href="/graph" className="text-link">Explore <ArrowRight size={14}/></Link></div>
    {loading ? <div className="graph-skeleton"><span/><span/><span/></div> : error ? <div className="inline-error">Could not load the graph. <button onClick={retry}>Retry</button></div> : graph?.nodes.length ? <div className="graph-visual compact">{graph.nodes.slice(0,7).map((node, i) => <button key={node.id} className={`graph-node node-${i%5}`} style={{left:`${[50,25,75,19,81,40,62][i]}%`,top:`${[48,25,28,69,70,85,12][i]}%`}} title={`${node.label} · ${node.frequency} mentions`}><span>{node.label}</span></button>)}<div className="graph-center-orb"><Network size={23}/></div></div> : <div className="graph-visual compact graph-example">{['Generative AI','Deep Learning','RAG','Large Language Models','Neural Networks','Transformers','Prompt Engineering'].map((label,i)=><span key={label} className={`graph-node node-${i%5}`} style={{left:`${[50,25,75,19,81,40,62][i]}%`,top:`${[48,25,28,69,70,85,12][i]}%`}}>{label}</span>)}<div className="graph-center-orb"><Network size={23}/></div><span className="example-stamp">ILLUSTRATION ONLY</span><Link href="/knowledge" className="graph-upload-link">Upload a PDF to build your graph</Link></div>}
  </Panel>;
}

function Knowledge() {
  const docs = useListDocuments();
  const requestUrl = useRequestUploadUrl();
  const register = useRegisterDocument();
  const process = useProcessDocument();
  const remove = useDeleteDocument();
  const qc = useQueryClient();
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadMessage, setUploadMessage] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [filter, setFilter] = useState('all');
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = async (input?: FileList | File[]) => {
    const candidates = Array.from(input ?? []);
    if (!candidates.length) return;
    setUploadError('');
    const errors: string[] = [];
    const validFiles = candidates.filter(file => {
      if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { errors.push(`${file.name}: only PDF files can be added.`); return false; }
      if (file.size > 20 * 1024 * 1024) { errors.push(`${file.name}: this PDF is larger than the 20 MB limit.`); return false; }
      if (file.size === 0) { errors.push(`${file.name}: this file appears to be empty.`); return false; }
      return true;
    });
    if (!validFiles.length) { setUploadError(errors.join(' ')); return; }
    setUploading(true);
    setUploadProgress(0);
    try {
      for (const [index, file] of validFiles.entries()) {
        setUploadMessage(`Adding ${index + 1} of ${validFiles.length}: ${file.name}`);
        try {
          const result = await requestUrl.mutateAsync({ data: { name: file.name, size: file.size, contentType: 'application/pdf' } });
          const response = await fetch(result.uploadURL, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/pdf' }, body: file });
          if (!response.ok) throw new Error('Secure file transfer did not complete.');
          const doc = await register.mutateAsync({ data: { name: file.name, sizeBytes: file.size, contentType: 'application/pdf', objectPath: result.objectPath } });
          void qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
          void qc.invalidateQueries({ queryKey: getGetDashboardStatsQueryKey() });
          await process.mutateAsync({ documentId: doc.id });
          void qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
          void qc.invalidateQueries({ queryKey: getGetDashboardStatsQueryKey() });
          void qc.invalidateQueries({ queryKey: getGetKnowledgeGraphQueryKey() });
        } catch (e) {
          errors.push(`${file.name}: ${e instanceof Error ? e.message : 'upload or processing failed.'}`);
        }
        setUploadProgress(Math.round(((index + 1) / validFiles.length) * 100));
      }
      setUploadError(errors.join(' '));
    } finally {
      setUploading(false);
      setUploadMessage('');
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const shownDocs = (docs.data || []).filter(d => filter === 'all' || d.status === filter);
  const del = (doc: Document) => { if (window.confirm(`Delete “${doc.name}” and its derived knowledge?`)) remove.mutate({ documentId: doc.id }, { onSuccess: () => { void qc.invalidateQueries({queryKey:getListDocumentsQueryKey()}); void qc.invalidateQueries({queryKey:getGetDashboardStatsQueryKey()}); void qc.invalidateQueries({queryKey:getGetKnowledgeGraphQueryKey()}); } }); };
  return <div className="page-stack fade-up">
    <Header eyebrow="YOUR LIBRARY" title="Knowledge base" subtitle="Add PDFs, follow their processing, and keep your research in one place."/>
    <section className={`upload-drop glass ${dragging ? 'is-dragging' : ''}`} onDragOver={e => {e.preventDefault();setDragging(true);}} onDragLeave={() => setDragging(false)} onDrop={e => {e.preventDefault();setDragging(false);void upload(e.dataTransfer.files);}}>
      <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple className="visually-hidden" onChange={(e: ChangeEvent<HTMLInputElement>) => void upload(e.target.files ?? undefined)} data-testid="input-pdf-upload"/>
      <div className="upload-symbol"><UploadCloud size={23}/><span/></div><div className="upload-copy"><strong>{uploading ? uploadMessage : 'Drop PDFs to add them to your library'}</strong><span>PDF only · up to 20 MB each · private to your workspace</span></div>
      <Button variant="primary" onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="button-choose-pdf">{uploading ? <><span className="tiny-loader"/> Processing</> : <><Plus size={15}/> Choose PDFs</>}</Button>
      {uploading && <div className="upload-progress"><span style={{width:`${uploadProgress}%`}}/></div>}
    </section>
    {uploadError && <div className="callout error"><X size={16}/><span>{uploadError}</span><button onClick={() => setUploadError('')} aria-label="Dismiss error"><X size={14}/></button></div>}
    {uploading && <div className="processing-note"><span className="pulse-dot"/> Secure transfer and document processing in progress. Keep this page open.</div>}
    <Panel className="library-panel"><div className="panel-heading library-heading"><div><span className="eyebrow">DOCUMENTS</span><h2>Your sources <span className="count-chip">{docs.data?.length ?? '—'}</span></h2></div><div className="filter-control"><Filter size={14}/><select aria-label="Filter documents by status" value={filter} onChange={e => setFilter(e.target.value)} data-testid="select-document-filter"><option value="all">All documents</option><option value="processed">Processed</option><option value="processing">Processing</option><option value="failed">Failed</option><option value="uploaded">Uploaded</option></select><ChevronDown size={13}/></div></div>
      {docs.isLoading ? <LoadingRows/> : docs.isError ? <QueryError retry={() => void docs.refetch()}/> : shownDocs.length ? <div className="library-table"><div className="table-head"><span>DOCUMENT</span><span>STATUS</span><span>ADDED</span><span>SIZE</span><span/></div>{shownDocs.map(doc => <div className="library-row" key={doc.id} data-testid={`row-document-${doc.id}`}><div className="table-document"><div className="pdf-icon"><FileText size={17}/><small>PDF</small></div><div><strong>{doc.name}</strong><small>{doc.pageCount ?? '—'} pages · {doc.conceptsCount} concepts</small></div></div><div><StatusPill status={doc.status}/>{doc.statusMessage && doc.status === 'failed' && <small className="status-message">{doc.statusMessage}</small>}</div><span className="table-muted">{fmtDate(doc.uploadedAt)}</span><span className="table-muted">{fmtSize(doc.sizeBytes)}</span><div className="row-actions">{doc.status === 'failed' && <Button onClick={() => process.mutate({documentId:doc.id},{onSuccess:()=>void qc.invalidateQueries({queryKey:getListDocumentsQueryKey()})})} className="small-btn" disabled={process.isPending}>Retry</Button>}<button className="icon-button delete-button" onClick={() => del(doc)} aria-label={`Delete ${doc.name}`} data-testid={`button-delete-document-${doc.id}`}><Trash2 size={15}/></button></div></div>)}</div> : <Empty icon={Files} title={filter === 'all' ? 'Your library is waiting for its first PDF' : `No ${filter} documents`} detail={filter === 'all' ? 'Upload a research paper, report, or book chapter. GraphMind will extract concepts and make it searchable.' : 'Try another status filter, or add a new document.'} action={filter === 'all' ? <Button variant="primary" onClick={() => fileRef.current?.click()}><UploadCloud size={15}/> Choose a PDF</Button> : undefined}/>}
    </Panel>
  </div>;
}

function EvidenceCard({ source, onOpen }: { source: EvidenceSource; onOpen?: () => void }) {
  return <button className="evidence-card" onClick={onOpen} data-testid={`evidence-${source.id}`}><div className="evidence-meta"><span className="source-badge"><FileText size={12}/>{source.documentName}</span><span className="page-label">PAGE {source.pageNumber}</span></div><p>“{source.passage}”</p><div className="evidence-foot">{source.concept && <span className="concept-chip">{source.concept}</span>}<span className="relevance"><span style={{width:`${Math.min(100,Math.max(0,source.relevance*100))}%`}}/>Match</span><ArrowRight size={13}/></div></button>;
}
function Chat() {
  const [, setLocation] = useLocation();
  const docs = useListDocuments();
  const ask = useAskKnowledgeBase();
  const history = useListQuestionHistory();
  const feedback = useSubmitAnswerFeedback();
  const qc = useQueryClient();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<HistoryItem | null>(null);
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [questionError, setQuestionError] = useState('');
  const activeDocs = (docs.data || []).filter(d => d.status === 'processed');
  const submit = (e?: {preventDefault:()=>void}) => { e?.preventDefault(); const q = question.trim(); if (q.length < 2) {setQuestionError('Write a little more so GraphMind knows what to look for.');return;} setQuestionError(''); ask.mutate({data:{question:q, ...(selectedDocs.length ? {documentIds:selectedDocs} : {})}},{onSuccess:item=>{setAnswer(item);setQuestion('');void qc.invalidateQueries({queryKey:getListQuestionHistoryQueryKey()});void qc.invalidateQueries({queryKey:getGetDashboardStatsQueryKey()});},onError:()=>setQuestionError('Your question could not be answered right now. Try again in a moment.')}); };
  const starters = ['What are the key themes across my documents?','How do the main concepts relate?','What evidence supports the central claim?'];
  return <div className="page-stack fade-up"><Header eyebrow="DOCUMENT-GROUNDED Q&A" title="Ask your knowledge base" subtitle="Every answer comes with passages you can verify in context." action={<Link href="/history" className="button button-secondary"><History size={15}/> Saved answers</Link>}/>
    <div className="chat-layout"><div className="chat-column"><Panel className="chat-panel"><div className="chat-topline"><span className="assistant-orb"><Sparkles size={16}/></span><span><b>Research assistant</b><small>Grounded in your processed documents</small></span><span className="grounded-indicator"><span className="live-dot"/> Evidence mode</span></div>
       {answer ? <div className="answer-view"><div className="question-bubble"><span className="question-mark"><MessageSquareText size={14}/></span><strong>{answer.question}</strong></div><div className="answer-block"><div className="answer-label"><Sparkles size={15}/> <span>ANSWER</span></div><p className="answer-typing">{answer.answer.replace(/^Demo search mode\s*[—-].*?\r?\n\r?\n/i, "").replace(/^\[\d+\]\s*/gm, "").trim()}</p><div className="answer-sources-heading"><span>According to your sources</span><span>{answer.sources.length} {answer.sources.length === 1 ? 'source' : 'sources'}</span></div>{answer.sources.length ? <div className="evidence-list">{answer.sources.map(s=><EvidenceCard key={s.id} source={s} onOpen={()=>setLocation(sourceHref(s,answer.id))}/>)}</div> : <div className="callout warning"><ShieldCheck size={15}/> No page-level citations were returned for this answer.</div>}<div className="feedback-row"><span>Was this answer helpful?</span><button onClick={()=>feedback.mutate({historyId:answer.id,data:{helpful:true}},{onSuccess:()=>{setAnswer(current=>current?.id===answer.id?{...current,helpful:true}:current);void qc.invalidateQueries({queryKey:getListQuestionHistoryQueryKey()});}})} className={answer.helpful===true?'feedback-active':''} aria-label="Mark answer helpful"><ThumbsUp size={14}/> Helpful</button><button onClick={()=>feedback.mutate({historyId:answer.id,data:{helpful:false}},{onSuccess:()=>{setAnswer(current=>current?.id===answer.id?{...current,helpful:false}:current);void qc.invalidateQueries({queryKey:getListQuestionHistoryQueryKey()});}})} className={answer.helpful===false?'feedback-active':''} aria-label="Mark answer not helpful"><ThumbsDown size={14}/> Not quite</button><button className="copy-answer" onClick={()=>void navigator.clipboard?.writeText(answer.answer)}><Copy size={13}/> Copy</button></div></div></div> : <div className="chat-empty"><div className="empty-pulse"><Sparkles size={24}/></div><h2>What would you like to understand?</h2><p>Ask a question across all processed sources, or narrow your search to selected documents.</p><div className="suggestions">{starters.map(s=><button key={s} onClick={()=>setQuestion(s)}>{s}<ArrowRight size={13}/></button>)}</div></div>}
      <form className="composer" onSubmit={submit}><textarea value={question} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submit();}}} placeholder="Ask a question about your documents…" aria-label="Ask a question" maxLength={4000} data-testid="input-chat-question"/><div className="composer-bottom"><div className="composer-context"><select aria-label="Choose document scope" value={selectedDocs.join(',')} onChange={e=>setSelectedDocs(e.target.value ? [e.target.value] : [])} data-testid="select-chat-document"><option value="">All processed documents</option>{activeDocs.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select><span><ShieldCheck size={12}/> Answers cite source pages</span></div><div className="composer-send"><small>{question.length}/4000</small><Button variant="primary" type="submit" disabled={ask.isPending || !question.trim()} data-testid="button-send-question">{ask.isPending ? <span className="tiny-loader"/> : <Send size={15}/>} Ask</Button></div></div></form>
      {questionError && <div className="inline-error form-error">{questionError}</div>}
    </Panel>
    {!activeDocs.length && !docs.isLoading && <div className="callout info"><Files size={16}/><span>No processed documents yet. Upload a PDF to get document-grounded answers.</span><Link href="/knowledge" className="text-link">Add a source <ArrowRight size={13}/></Link></div>}
    </div><Panel className="chat-history"><div className="panel-heading"><div><span className="eyebrow">RECENT</span><h2>Question history</h2></div><Link className="icon-arrow" href="/history"><ArrowRight size={15}/></Link></div>{history.isLoading?<LoadingRows/>:history.isError?<div className="mini-empty">History is unavailable.</div>:history.data?.length?<div className="history-list">{history.data.slice(0,8).map(item=><button key={item.id} className={`history-preview ${answer?.id===item.id?'selected':''}`} onClick={()=>{setAnswer(item);window.scrollTo({top:0,behavior:'smooth'});}}><span className="history-preview-top"><span className={`mode-dot ${item.mode}`}/>{fmtDate(item.createdAt)}</span><strong>{item.question}</strong><small>{item.sources.length} citations · {item.mode==='ai'?'Live AI':'Demo search'}</small></button>)}</div>:<div className="mini-empty">Your saved answers will show up here.</div>}</Panel></div>
  </div>;
}

function Graph() {
  const [, setLocation] = useLocation();
  const docs = useListDocuments();
  const [search, setSearch] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [relationshipType, setRelationshipType] = useState('');
  const params = useMemo(() => ({
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(documentId ? { documentId } : {}),
    ...(relationshipType ? { relationshipType } : {}),
  }), [search, documentId, relationshipType]);
  const graph = useGetKnowledgeGraph(params, {query:{queryKey:getGetKnowledgeGraphQueryKey(params)}});
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const detail = useGetConcept(selected || '', {query:{enabled:!!selected,queryKey:getGetConceptQueryKey(selected || '')}});
  const relationship = useGetRelationship(selectedEdge || '', {query:{enabled:!!selectedEdge,queryKey:getGetRelationshipQueryKey(selectedEdge || '')}});
  const nodes = graph.data?.nodes || [];
  const edges = graph.data?.edges || [];
  const selectedNode = nodes.find(n=>n.id===selected);
  const selectedRelationship = edges.find(e=>e.id===selectedEdge);
  const isExample = Boolean(graph.data && nodes.length === 0);
  useEffect(() => {
    if (selected && !nodes.some(node => node.id === selected)) setSelected(null);
    if (selectedEdge && !edges.some(edge => edge.id === selectedEdge)) setSelectedEdge(null);
  }, [nodes, edges, selected, selectedEdge]);
  return <div className="page-stack fade-up"><Header eyebrow="IDEA MAP" title="Knowledge graph" subtitle="Explore relationships supported by passages in your documents." action={<span className="graph-count">{nodes.length} <small>concepts</small><i/> {edges.length} <small>connections</small></span>}/>
    <div className="graph-filter-bar"><label className="search-field"><Search size={15}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Find a concept…" aria-label="Search graph concepts"/></label><label className="filter-control"><Filter size={14}/><select value={documentId} onChange={e=>setDocumentId(e.target.value)} aria-label="Filter graph by document"><option value="">All documents</option>{docs.data?.map(doc=><option key={doc.id} value={doc.id}>{doc.name}</option>)}</select><ChevronDown size={13}/></label><label className="filter-control"><GitBranch size={14}/><select value={relationshipType} onChange={e=>setRelationshipType(e.target.value)} aria-label="Filter graph relationships"><option value="">All connections</option><option value="mentioned with">Mentioned together</option></select><ChevronDown size={13}/></label></div>
    {graph.isLoading ? <Panel className="graph-canvas"><div className="graph-loading"><span/><span/><span/></div></Panel> : graph.isError ? <QueryError retry={()=>void graph.refetch()}/> : null}
    {!graph.isLoading && !graph.isError && graph.data && <>
      {isExample && <div className="callout info"><HelpCircle size={16}/><span>This illustrative graph is not based on your documents. Upload a PDF to build a graph from its extracted evidence.</span><Link href="/knowledge" className="text-link">Add documents <ArrowRight size={13}/></Link></div>}
      <div className="graph-workspace"><Panel className={`graph-canvas grid-glow ${isExample?'is-example':''}`}><div className="graphflow-frame"><GraphFlow nodes={nodes} edges={edges} isExample={isExample} selectedNodeId={selected} selectedEdgeId={selectedEdge} onNodeClick={id=>{setSelected(id);setSelectedEdge(null);}} onEdgeClick={id=>{setSelectedEdge(id);setSelected(null);}}/></div>{isExample&&<span className="example-stamp graph-example-stamp">ILLUSTRATION · NOT DOCUMENT EVIDENCE</span>}</Panel>
      <Panel className="graph-inspector"><span className="eyebrow">{selectedEdge ? 'RELATIONSHIP' : 'CONCEPT DETAIL'}</span>{isExample ? <div className="inspector-empty"><div className="inspector-orbit"><Network size={22}/></div><strong>Build your own concept map</strong><span>Example links are visual only. Your graph will use evidence extracted from uploaded PDFs.</span><Link href="/knowledge" className="button button-primary"><UploadCloud size={14}/> Add a PDF</Link></div> : selectedNode ? <><h2>{detail.data?.concept.label || selectedNode.label}</h2><p>{detail.data?.concept.description || selectedNode.description || 'A concept found in your processed documents.'}</p><div className="detail-stats"><span><b>{selectedNode.frequency}</b> mentions</span><span><b>{selectedNode.documentIds.length}</b> documents</span></div>{detail.isLoading&&<LoadingRows/>}<div className="inspector-subtitle">DOCUMENT PAGES</div>{detail.data?.sources.length ? detail.data.sources.slice(0,8).map(source=><button className="page-reference page-reference-button" key={source.id} onClick={()=>setLocation(sourceHref(source))}><FileText size={14}/><span>{source.documentName} · Page {source.pageNumber}</span><ArrowRight size={13}/></button>) : selectedNode.pages.map((page,i)=><div className="page-reference" key={`${page}-${i}`}><FileText size={14}/><span>Page {page}</span><span className="page-ref-dot"/></div>)}<div className="inspector-subtitle">SUPPORTED CONNECTIONS</div>{(detail.data?.relationships||edges.filter(e=>e.source===selectedNode.id||e.target===selectedNode.id)).map(edge=><button key={edge.id} className="relationship-link" onClick={()=>{setSelectedEdge(edge.id);setSelected(null);}}><span>{edge.label}</span><ChevronRight size={13}/></button>)}</> : selectedRelationship ? <><h2>{relationship.data?.label || selectedRelationship.label}</h2><div className="relation-path">{nodes.find(node=>node.id===selectedRelationship.source)?.label || selectedRelationship.source}<ArrowRight size={13}/>{nodes.find(node=>node.id===selectedRelationship.target)?.label || selectedRelationship.target}</div><p className="quote-evidence">“{relationship.data?.evidence || selectedRelationship.evidence}”</p><button className="relation-source relation-source-button" onClick={()=>setLocation(pageHref(selectedRelationship.documentId,selectedRelationship.pageNumber))}><FileText size={14}/><span>{selectedRelationship.documentName}<small>Page {selectedRelationship.pageNumber}</small></span><ArrowRight size={13}/></button></> : <div className="inspector-empty"><div className="inspector-orbit"><Network size={22}/></div><strong>Select a concept or connection</strong><span>Inspect its supporting details and document evidence.</span></div>}</Panel></div>
      <div className="graph-legend"><span><i className="legend-node violet"/> Concepts</span><span><i className="legend-line"/> {isExample?'Illustrative link':'Evidence-backed relationship'}</span><span><ShieldCheck size={13}/> {isExample?'Example only':'Every connection has source evidence'}</span></div>
    </>}
  </div>;
}

function Sources() {
  const searchParams = new URLSearchParams(window.location.search);
  const [search, setSearch] = useState('');
  const [docId, setDocId] = useState(searchParams.get('documentId') || '');
  const [historyId, setHistoryId] = useState(searchParams.get('historyId') || '');
  const [pageFilter, setPageFilter] = useState(searchParams.get('pageNumber') || 'all');
  const preferredSourceId = searchParams.get('sourceId') || '';
  const params = useMemo(()=>({...(search.trim()?{search:search.trim()}:{}),...(docId?{documentId:docId}:{}),...(historyId?{historyId}:{})}),[search,docId,historyId]);
  const sources = useListSources(params,{query:{queryKey:getListSourcesQueryKey(params)}});
  const docs = useListDocuments();
  const [active, setActive] = useState<EvidenceSource|null>(null);
  const filteredSources = useMemo(()=>(sources.data||[]).filter(s=>pageFilter==='all'||String(s.pageNumber)===pageFilter),[sources.data,pageFilter]);
  const sourceAvailable = Boolean(active && docs.data?.some(doc=>doc.id===active.documentId));
  const page = useGetDocumentPage(active?.documentId || '', active?.pageNumber || 1, {query:{enabled:!!active&&sourceAvailable,queryKey:getGetDocumentPageQueryKey(active?.documentId || '',active?.pageNumber || 1)}});
  const documentDetails = useGetDocument(active?.documentId || '', {query:{enabled:!!active&&sourceAvailable,queryKey:getGetDocumentQueryKey(active?.documentId || '')}});
  useEffect(()=>{
    if (!filteredSources.length) { setActive(null); return; }
    if (active && filteredSources.some(source=>source.id===active.id)) return;
    setActive(filteredSources.find(source=>source.id===preferredSourceId)||filteredSources[0]);
  },[filteredSources,active,preferredSourceId]);
  return <div className="page-stack fade-up"><Header eyebrow="EVIDENCE LIBRARY" title="Sources & citations" subtitle="Search the exact passages that support your answers and concept map."/>
    <div className="source-controls"><label className="search-field"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search passage, concept, or document…" aria-label="Search evidence sources" data-testid="input-source-search"/>{search&&<button onClick={()=>setSearch('')} aria-label="Clear search"><X size={14}/></button>}</label><label className="filter-control"><Filter size={14}/><select value={docId} onChange={e=>setDocId(e.target.value)} aria-label="Filter sources by document" data-testid="select-source-document"><option value="">All documents</option>{docs.data?.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select><ChevronDown size={13}/></label><label className="filter-control page-filter-control"><FileText size={14}/><select value={pageFilter} onChange={e=>setPageFilter(e.target.value)} aria-label="Filter sources by page"><option value="all">All pages</option>{Array.from(new Set((sources.data||[]).map(s=>s.pageNumber))).sort((a,b)=>a-b).map(pageNumber=><option key={pageNumber} value={String(pageNumber)}>Page {pageNumber}</option>)}</select><ChevronDown size={13}/></label>{historyId&&<button className="button button-quiet clear-history-filter" onClick={()=>{setHistoryId('');setActive(null);}}>Show all evidence <X size={13}/></button>}</div>
    {historyId&&<div className="callout info"><History size={15}/><span>Showing the saved citation snapshot for one answer. The original document may have changed or been deleted.</span></div>}
    <div className="sources-layout"><Panel className="sources-list-panel"><div className="source-results-head"><span>{filteredSources.length} passages</span><span>Matching page evidence</span></div>{sources.isLoading?<LoadingRows/>:sources.isError?<QueryError retry={()=>void sources.refetch()}/>:filteredSources.length?<div className="sources-list">{filteredSources.map(s=><div key={s.id} className={`source-list-item ${active?.id===s.id?'active':''}`}><EvidenceCard source={s} onOpen={()=>setActive(s)}/></div>)}</div>:<Empty icon={FileSearch} title={historyId?'No saved citations for this answer':'No matching passages'} detail={historyId?'This answer did not retain page-level evidence.':'Process a PDF or adjust the document, page, or search filters.'}/>}</Panel>
      <Panel className="source-detail"><span className="eyebrow">PASSAGE INSPECTOR</span>{active?<><div className="source-title"><FileText size={18}/><h2>{documentDetails.data?.name || active.documentName}</h2></div><div className="page-chip">Page {active.pageNumber}{documentDetails.data?.pageCount ? ` of ${documentDetails.data.pageCount}` : ''} <span>·</span> {active.concept || 'Evidence passage'}</div>{!docs.isLoading&&!sourceAvailable?<><div className="callout warning source-unavailable"><ShieldCheck size={15}/><span>Original document unavailable. This saved citation passage is preserved, but its surrounding page can no longer be loaded.</span></div><div className="document-preview"><div className="preview-page-top"><span>SAVED CITATION SNAPSHOT</span><span>PAGE {active.pageNumber}</span></div><div className="preview-text"><p className="highlighted-passage">{active.passage}</p></div><div className="preview-page-foot"><span>Preserved citation · GraphMind AI</span><span><ShieldCheck size={12}/> Snapshot available</span></div></div></>:<div className="document-preview"><div className="preview-page-top"><span>DOCUMENT EXCERPT</span><span>PAGE {active.pageNumber}</span></div>{page.isLoading?<div className="skeleton-list"><span/><span/><span/></div>:page.isError?<div className="inline-error">Could not load page evidence.</div>:<div className="preview-text">{(page.data?.passages || [active]).map(p=><p key={p.id} className={p.passage===active.passage?'highlighted-passage':''}>{p.passage}</p>)}</div>}<div className="preview-page-foot"><span>Source evidence · GraphMind AI</span><span><ShieldCheck size={12}/> Verified citation</span></div></div>}<div className="source-meta-grid"><div><small>RELEVANCE</small><strong>{Math.round(active.relevance*100)}%</strong></div><div><small>CITED</small><strong>{fmtDate(active.referencedAt)}</strong></div></div></>:<div className="inspector-empty"><div className="inspector-orbit"><FileSearch size={21}/></div><strong>Choose a passage to verify</strong><span>Open a citation to see its page-level context and relevance.</span></div>}</Panel>
    </div>
  </div>;
}

function Analytics() {
  const [range,setRange]=useState<'7d'|'30d'|'all'>('30d');
  const params=useMemo(()=>({range}),[range]);
  const analytics=useGetAnalytics(params,{query:{queryKey:getGetAnalyticsQueryKey(params)}});
  const data=analytics.data;
  return <div className="page-stack fade-up"><Header eyebrow="WORKSPACE ACTIVITY" title="Analytics" subtitle="A factual view of usage and processing in your workspace." action={<label className="range-select"><Clock3 size={14}/><select value={range} onChange={e=>setRange(e.target.value as '7d'|'30d'|'all')} aria-label="Analytics date range" data-testid="select-analytics-range"><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="all">All time</option></select><ChevronDown size={13}/></label>}/>{analytics.isLoading?<Panel className="analytics-loading"><LoadingRows/></Panel>:analytics.isError?<QueryError retry={()=>void analytics.refetch()}/>:data?<><div className="stats-grid analytics-stats">{[
    ['Questions asked',data.stats.questionsAsked,MessageSquareText,'blue'],['Processed PDFs',data.stats.processedDocuments,Files,'violet'],['Concepts extracted',data.stats.conceptsExtracted,Sparkles,'mint'],['Connections found',data.stats.connectionsFound,GitBranch,'gold'],
  ].map(([label,value,Icon,color])=>{const I=Icon as typeof Activity;return <Panel className={`stat-card stat-${color}`} key={label as string}><div className="stat-top"><span>{label as string}</span><span className={`stat-icon ${color}`}><I size={18}/></span></div><strong>{value as number}</strong><small><span className="stat-bullet"/> Stored account data</small></Panel>})}</div>
  <div className="analytics-grid"><Panel className="activity-chart-panel"><div className="panel-heading"><div><span className="eyebrow">QUESTION ACTIVITY</span><h2>Questions over time</h2></div><span className="chart-tag"><span className="live-dot"/> {data.questionsByDate.reduce((s,d)=>s+d.count,0)} total</span></div>{data.questionsByDate.length?<BarTimeline rows={data.questionsByDate.map(d=>({label:d.date,count:d.count}))}/>:<Empty icon={Activity} title="No question activity in this range" detail="Ask your first document-grounded question to start a trend."/>}</Panel>
  <Panel className="processing-panel"><div className="panel-heading"><div><span className="eyebrow">DOCUMENT HEALTH</span><h2>Processing status</h2></div></div>{data.processingBreakdown.length?<div className="processing-breakdown">{data.processingBreakdown.map(row=><div className="breakdown-row" key={row.status}><span className={`breakdown-mark ${row.status}`}/><span>{row.status}</span><strong>{row.count}</strong></div>)}</div>:<div className="mini-empty">No processing data recorded.</div>}<div className="breakdown-total"><span>All uploaded documents</span><b>{data.stats.documentsUploaded}</b></div></Panel>
  <Panel className="ranked-panel"><div className="panel-heading"><div><span className="eyebrow">MOST REFERENCED</span><h2>Top concepts</h2></div><Sparkles size={16}/></div>{data.topConcepts.length?<RankedList rows={data.topConcepts}/>:<div className="mini-empty">Concepts appear after PDFs are processed.</div>}</Panel>
  <Panel className="ranked-panel"><div className="panel-heading"><div><span className="eyebrow">MOST EXPLORED</span><h2>Top documents</h2></div><FileText size={16}/></div>{data.topDocuments.length?<RankedList rows={data.topDocuments}/>:<div className="mini-empty">No document activity in this range.</div>}</Panel>
  <Panel className="growth-panel"><div className="panel-heading"><div><span className="eyebrow">KNOWLEDGE GRAPH</span><h2>Graph growth</h2></div><Link href="/graph" className="text-link">Open graph <ArrowRight size={13}/></Link></div>{data.graphGrowth.length?<BarTimeline rows={data.graphGrowth.map(d=>({label:d.date,count:d.count}))}/>:<div className="mini-empty">Your graph grows as new concepts are extracted.</div>}</Panel></div></>:null}</div>;
}
function BarTimeline({rows}:{rows:{label:string;count:number}[]}) {
  const max=Math.max(...rows.map(r=>r.count),1);
  return <div className="timeline-chart"><div className="y-guides"><span>{max}</span><span>{Math.round(max*.66)}</span><span>{Math.round(max*.33)}</span><span>0</span></div><div className="timeline-bars">{rows.slice(-14).map((r,i)=><div className="timeline-column" key={`${r.label}-${i}`} title={`${r.label}: ${r.count}`}><div className="timeline-bar" style={{height:`${Math.max(3,r.count/max*100)}%`}}/><small>{formatTick(r.label,i,rows.length)}</small></div>)}</div></div>;
}
function formatTick(label:string,i:number,length:number) { if(length>8&&i!==0&&i!==length-1&&i%3!==0)return ''; const d=new Date(label); return Number.isNaN(d.getTime())?label:new Intl.DateTimeFormat('en',{month:'short',day:'numeric'}).format(d); }
function RankedList({rows}:{rows:{label:string;count:number}[]}) { const max=Math.max(...rows.map(r=>r.count),1); return <div className="ranked-list">{rows.slice(0,7).map((r,i)=><div className="ranked-row" key={r.label}><span className="rank-number">{String(i+1).padStart(2,'0')}</span><span className="rank-label">{r.label}<i><b style={{width:`${r.count/max*100}%`}}/></i></span><strong>{r.count}</strong></div>)}</div>; }

function HistoryPage() {
  const [, setLocation] = useLocation();
  const history=useListQuestionHistory();
  const remove=useDeleteHistoryItem();
  const qc=useQueryClient();
  const [selected,setSelected]=useState<string|null>(null);
  const selectedQuery=useGetHistoryItem(selected||'',{query:{enabled:!!selected,queryKey:getGetHistoryItemQueryKey(selected||'')}});
  const item=selectedQuery.data;
  const [copied,setCopied]=useState(false);
  const deleteItem=(id:string)=>{if(window.confirm('Delete this saved answer? This cannot be undone.'))remove.mutate({historyId:id},{onSuccess:()=>{if(selected===id)setSelected(null);void qc.invalidateQueries({queryKey:getListQuestionHistoryQueryKey()});void qc.invalidateQueries({queryKey:getGetDashboardStatsQueryKey()});}});};
  const copy=async(text:string)=>{await navigator.clipboard?.writeText(text);setCopied(true);window.setTimeout(()=>setCopied(false),1600);};
  return <div className="page-stack fade-up"><Header eyebrow="SAVED RESEARCH" title="Question history" subtitle="Reopen previous answers, revisit their evidence, or clear out what you no longer need."/>
    <div className="history-workspace"><Panel className="history-table-panel"><div className="history-table-head"><span>QUESTION</span><span>MODE</span><span>ASKED</span><span>EVIDENCE</span><span/></div>{history.isLoading?<LoadingRows/>:history.isError?<QueryError retry={()=>void history.refetch()}/>:history.data?.length?<div className="saved-history-list">{history.data.map(h=><div className={`saved-answer-row ${selected===h.id?'active':''}`} key={h.id}><button className="saved-question" onClick={()=>setSelected(h.id)} data-testid={`button-open-history-${h.id}`}><MessageSquareText size={15}/><span><strong>{h.question}</strong><small>{h.documentNames.length ? h.documentNames.join(', ') : 'Workspace search'}</small></span></button><span className={`mode-pill mode-${h.mode}`}>{h.mode==='ai'?'LIVE AI':'DEMO'}</span><span className="table-muted">{fmtDate(h.createdAt)}</span><span className="citation-count"><FileSearch size={13}/>{h.sources.length}</span><button className="icon-button delete-button" aria-label="Delete saved answer" onClick={()=>deleteItem(h.id)} data-testid={`button-delete-history-${h.id}`}><Trash2 size={14}/></button></div>)}</div>:<Empty icon={History} title="No saved answers yet" detail="Questions you ask will be saved here with their original citations." action={<Link href="/chat" className="button button-primary"><MessageSquareText size={15}/> Ask a question</Link>}/>}</Panel>
    <Panel className="history-detail"><span className="eyebrow">ANSWER DETAIL</span>{!selected?<div className="inspector-empty"><div className="inspector-orbit"><History size={21}/></div><strong>Select an answer to reopen it</strong><span>Your answer and its exact cited passages will appear here.</span></div>:selectedQuery.isLoading?<LoadingRows/>:selectedQuery.isError?<div className="inline-error">This answer could not be reopened.</div>:item?<><h2>{item.question}</h2><div className="history-detail-meta"><span className={`mode-pill mode-${item.mode}`}>{item.mode==='ai'?'LIVE AI':'DEMO SEARCH'}</span><span>{fmtDate(item.createdAt)}</span></div><p className="history-answer-copy">{item.answer}</p><div className="inspector-subtitle">CITED EVIDENCE · {item.sources.length}</div><div className="evidence-list">{item.sources.map(s=><EvidenceCard key={s.id} source={s} onOpen={()=>setLocation(sourceHref(s,item.id))}/>)}</div><div className="history-detail-actions"><Button onClick={()=>void copy(item.answer)}>{copied?<Check size={14}/>:<Copy size={14}/>} {copied?'Copied':'Copy answer'}</Button><Link href="/chat" className="button button-primary"><MessageSquareText size={14}/> Ask another</Link></div></>:null}</Panel></div>
  </div>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><RoutedErrorBoundary><AppFrame/></RoutedErrorBoundary></WouterRouter><Toaster/></TooltipProvider></QueryClientProvider>;
}
export default App;
