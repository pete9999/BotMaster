// Project starter templates — real API-based, no mock data.
// Complexity levels 1–4; chain depth = longest sequential dependency path.

export interface TaskTemplate {
  title: string
  description: string
  priority: number
  runner_type: string
  model_hint: string
  depends_on_index: number[]
  notes?: string
}

export interface ProjectTemplate {
  id: string
  level: 1 | 2 | 3 | 4
  label: string
  description: string
  why: string
  tech_stack: string
  mission_name: string
  mission_description: string
  mission_success_criteria: string
  mission_tech_notes: string
  model_hint: string
  tasks: TaskTemplate[]
  agents: number
  tags: string[]
}

// ── Level 1: Single bot, 1-3 tasks, no complex deps ────────────────────────

const HELLO_API: ProjectTemplate = {
  id: 'hello-api',
  level: 1,
  label: 'Hello World API',
  description: 'FastAPI endpoint returning {"message":"Hello, World!"}. One bot, two tasks.',
  why: 'Tests the absolute minimum: claim task → write code → write test → mark done.',
  tech_stack: 'FastAPI + Python',
  mission_name: 'Build Hello World API',
  mission_description: 'Minimal FastAPI app with a single GET /hello endpoint and a pytest suite.',
  mission_success_criteria: 'GET /hello returns HTTP 200 with {"message": "Hello, World!"}. pytest passes.',
  mission_tech_notes: 'Python 3.11+. FastAPI + uvicorn. Single file main.py. No database.',
  model_hint: 'claude-haiku-4-5-20251001',
  agents: 1,
  tags: ['level-1', 'python', 'api', 'single-bot'],
  tasks: [
    {
      title: 'Create FastAPI app with GET /hello',
      description: 'Single file main.py. FastAPI app with GET /hello returning {"message":"Hello, World!"}. Include uvicorn __main__ block.',
      priority: 100, runner_type: 'claude_code', model_hint: 'claude-haiku-4-5-20251001',
      depends_on_index: [],
    },
    {
      title: 'Write pytest unit test for /hello',
      description: 'Use FastAPI TestClient. Assert HTTP 200 and body equals {"message":"Hello, World!"}. Save as test_main.py.',
      priority: 90, runner_type: 'claude_code', model_hint: 'claude-haiku-4-5-20251001',
      depends_on_index: [0],
    },
  ],
}

const CLI_TOOL: ProjectTemplate = {
  id: 'cli-password-gen',
  level: 1,
  label: 'CLI Password Generator',
  description: 'Python CLI that generates secure passwords with configurable length and character sets.',
  why: 'Tests single-bot CLI project: argparse, secrets module, testing with pytest, packaging.',
  tech_stack: 'Python CLI',
  mission_name: 'Build Password Generator CLI',
  mission_description: 'CLI tool: `passgen --length 16 --symbols` outputs a cryptographically secure password.',
  mission_success_criteria: 'passgen runs from CLI. Accepts --length, --no-symbols, --count flags. pytest passes for all flag combos.',
  mission_tech_notes: 'Python 3.11+. Use `secrets` module (not random). argparse for CLI. Single file passgen.py. No third-party deps.',
  model_hint: 'claude-haiku-4-5-20251001',
  agents: 1,
  tags: ['level-1', 'python', 'cli', 'single-bot'],
  tasks: [
    {
      title: 'Implement passgen.py with argparse',
      description: 'CLI with --length (default 16), --no-symbols flag, --count (default 1). Use secrets.choice() for cryptographic randomness. Print one password per line.',
      priority: 100, runner_type: 'claude_code', model_hint: 'claude-haiku-4-5-20251001',
      depends_on_index: [],
    },
    {
      title: 'Write pytest suite for passgen',
      description: 'Test: correct length, symbols present/absent by flag, --count produces N lines, entropy (no two consecutive identical). Import passgen as module.',
      priority: 90, runner_type: 'claude_code', model_hint: 'claude-haiku-4-5-20251001',
      depends_on_index: [0],
    },
  ],
}

const LANDING_PAGE: ProjectTemplate = {
  id: 'landing-page',
  level: 1,
  label: 'Static Landing Page',
  description: 'Single-page marketing site: hero, features grid, pricing table, CTA. Pure HTML + Tailwind CDN.',
  why: 'Ultra-simple frontend test: no build tool, no framework. Bot writes and opens a single HTML file.',
  tech_stack: 'HTML + Tailwind CDN',
  mission_name: 'Build Marketing Landing Page',
  mission_description: 'Static HTML landing page for a fictional SaaS product. Hero with headline + CTA, 3-column features grid, 3-tier pricing table, footer.',
  mission_success_criteria: 'index.html opens in browser with no errors. Responsive at 375px and 1280px. CTA button visible above fold.',
  mission_tech_notes: 'Single index.html file. Tailwind via CDN script tag — no npm. Use placeholder images (via picsum.photos). Fictional product: "Flowly — AI workflow automation".',
  model_hint: 'claude-haiku-4-5-20251001',
  agents: 1,
  tags: ['level-1', 'html', 'tailwind', 'frontend', 'single-bot'],
  tasks: [
    {
      title: 'Build landing page HTML structure and hero',
      description: 'index.html with Tailwind CDN. Sticky nav, hero section (headline, subline, email signup CTA), responsive container. Use dark navy + yellow accent colour scheme.',
      priority: 100, runner_type: 'claude_code', model_hint: 'claude-haiku-4-5-20251001',
      depends_on_index: [],
    },
    {
      title: 'Add features grid, pricing table, and footer',
      description: '3-column features grid with icons (use emoji). 3-tier pricing cards (Free/Pro/Enterprise) with feature lists and highlighted "Popular" badge on Pro. Simple footer with links.',
      priority: 90, runner_type: 'claude_code', model_hint: 'claude-haiku-4-5-20251001',
      depends_on_index: [0],
    },
  ],
}

// ── Level 2: Single bot, sequential chain, 4-6 tasks ───────────────────────

const PORTFOLIO: ProjectTemplate = {
  id: 'static-portfolio',
  level: 2,
  label: 'Portfolio Site',
  description: 'Three-page React portfolio: About, Projects, Contact. Single bot, sequential tasks.',
  why: 'Tests sequential dependencies: scaffold → pages in order → bot idles between tasks.',
  tech_stack: 'React + TypeScript + Tailwind',
  mission_name: 'Build Portfolio Site',
  mission_description: 'Three-page portfolio: About (bio + skills), Projects (cards), Contact (client-side form validation).',
  mission_success_criteria: 'All 3 pages render. Mobile responsive. Contact form validates. Vite build passes.',
  mission_tech_notes: 'React 18 + TypeScript + Tailwind 4. Vite. Static — no backend. Hardcode 4 mock projects.',
  model_hint: 'claude-sonnet-4-6',
  agents: 1,
  tags: ['level-2', 'react', 'frontend', 'single-bot', 'sequential'],
  tasks: [
    {
      title: 'Scaffold Vite + React + Tailwind + Router',
      description: 'npm create vite. Install Tailwind 4, react-router-dom. App.tsx with layout shell and routes for /about, /projects, /contact.',
      priority: 100, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [],
    },
    {
      title: 'Build About page',
      description: 'Bio paragraph, skills grid (8 skills with lucide-react icons), timeline of 3 experience entries.',
      priority: 90, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [0],
    },
    {
      title: 'Build Projects page',
      description: '4 hardcoded project cards. Each: title, description, tech tags, GitHub link. Responsive 2-col grid.',
      priority: 80, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [0],
    },
    {
      title: 'Build Contact page with form validation',
      description: 'Name (required), email (validated), message (min 10 chars). Client-side validation with error messages. No backend.',
      priority: 70, runner_type: 'claude_code', model_hint: 'claude-haiku-4-5-20251001',
      depends_on_index: [0],
    },
  ],
}

const NOTES_API: ProjectTemplate = {
  id: 'notes-api',
  level: 2,
  label: 'Notes REST API',
  description: 'Full CRUD notes API with tags, search, and markdown export. Five sequential tasks, single bot.',
  why: 'Tests a longer sequential chain with real feature progression: schema → CRUD → search → export → tests.',
  tech_stack: 'FastAPI + SQLite + Python',
  mission_name: 'Build Notes REST API',
  mission_description: 'REST API for a note-taking app. Notes have title, body, tags. Full CRUD + search + markdown export endpoint.',
  mission_success_criteria: 'All CRUD endpoints work. Search by title/tag returns correct results. GET /notes/{id}/export returns markdown. Full pytest suite passes.',
  mission_tech_notes: 'Python 3.11+. FastAPI + uvicorn + pydantic v2. Raw sqlite3 — no ORM. Pytest with in-memory DB fixture.',
  model_hint: 'claude-sonnet-4-6',
  agents: 1,
  tags: ['level-2', 'python', 'api', 'single-bot', 'sequential'],
  tasks: [
    {
      title: 'Database schema — notes and tags tables',
      description: 'notes table: id (TEXT PK), title, body, created_at, updated_at. tags table: id, note_id (FK), name. init_db.py migration script.',
      priority: 100, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [],
    },
    {
      title: 'CRUD endpoints — GET/POST/PATCH/DELETE /notes',
      description: 'Full REST CRUD. Pydantic models for request/response. Include tags array in responses. 404 on missing ID.',
      priority: 90, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [0],
    },
    {
      title: 'Search endpoint — GET /notes?q=&tag=',
      description: 'Filter by title/body text search (LIKE) and/or tag name. Return paginated results with total count.',
      priority: 80, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [1],
    },
    {
      title: 'Markdown export — GET /notes/{id}/export',
      description: 'Returns the note as a formatted markdown document with frontmatter (title, tags, created_at). Content-Type: text/markdown.',
      priority: 70, runner_type: 'claude_code', model_hint: 'claude-haiku-4-5-20251001',
      depends_on_index: [1],
    },
    {
      title: 'Pytest suite — all endpoints',
      description: 'CRUD happy path + 404 cases. Search: text match, tag filter, combined. Export: valid markdown output. In-memory SQLite fixture.',
      priority: 60, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [2, 3],
    },
  ],
}

const BLOG_SITE: ProjectTemplate = {
  id: 'markdown-blog',
  level: 2,
  label: 'Markdown Blog',
  description: 'Static React blog that renders local markdown files. Five-task chain: setup → MDX → post list → post page → styling.',
  why: 'Tests a linear chain with increasing feature complexity. Each task genuinely depends on the previous.',
  tech_stack: 'React + TypeScript + Vite + MDX',
  mission_name: 'Build Static Markdown Blog',
  mission_description: 'Blog site that reads .md files from /posts. Home page lists posts. Click through to read full post. Dark/light toggle.',
  mission_success_criteria: 'At least 3 sample posts render correctly. Home page lists posts sorted by date. Code blocks syntax-highlighted. Dark mode toggle works.',
  mission_tech_notes: 'React 18 + TypeScript + Vite. Use vite-plugin-mdx or gray-matter + marked for frontmatter parsing. Tailwind 4 for styling. Prism.js for code highlighting.',
  model_hint: 'claude-sonnet-4-6',
  agents: 1,
  tags: ['level-2', 'react', 'frontend', 'single-bot', 'sequential', 'markdown'],
  tasks: [
    {
      title: 'Scaffold Vite + React + Tailwind + routing',
      description: 'npm create vite. Tailwind 4, react-router-dom, gray-matter, marked. Basic layout with nav.',
      priority: 100, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [],
    },
    {
      title: 'Create markdown post loader utility',
      description: 'posts/ directory with 3 sample .md files with frontmatter (title, date, tags, excerpt). Utility function to load and parse all posts at build time using import.meta.glob.',
      priority: 90, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [0],
    },
    {
      title: 'Build home page — post list',
      description: 'Grid of post cards sorted by date. Each shows title, date, tags, excerpt. Click navigates to /posts/:slug.',
      priority: 80, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [1],
    },
    {
      title: 'Build post page — full markdown render',
      description: 'Render markdown to HTML using marked. Syntax-highlighted code blocks (add prism.js). Title, date, tags shown above content.',
      priority: 70, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [1],
    },
    {
      title: 'Add dark/light mode toggle and polish',
      description: 'Dark mode via Tailwind dark: classes. Toggle button in nav persists to localStorage. Responsive layout down to 375px.',
      priority: 60, runner_type: 'claude_code', model_hint: 'claude-haiku-4-5-20251001',
      depends_on_index: [2, 3],
    },
  ],
}

// ── Level 3: Two bots, parallel tracks, 5-8 tasks ──────────────────────────

const TODO_APP: ProjectTemplate = {
  id: 'todo-app',
  level: 3,
  label: 'Full-Stack Todo App',
  description: 'FastAPI backend + React frontend. Two bots on separate branches in parallel.',
  why: 'Tests multi-agent coordination: API bot and UI bot run concurrently on separate branches.',
  tech_stack: 'FastAPI + React + TypeScript',
  mission_name: 'Build Todo App — Backend',
  mission_description: 'REST API: full CRUD for todos (id, title, done, priority, tag). SQLite, no ORM.',
  mission_success_criteria: 'All CRUD endpoints pass pytest. OpenAPI at /docs. Runs on port 8000.',
  mission_tech_notes: 'Python 3.11. FastAPI + uvicorn + pydantic v2. Raw sqlite3. Pytest for tests.',
  model_hint: 'claude-sonnet-4-6',
  agents: 2,
  tags: ['level-3', 'fullstack', 'multi-bot', 'parallel', 'fastapi', 'react'],
  tasks: [
    {
      title: 'Database schema — todos table',
      description: 'todos: id (TEXT PK), title, done (BOOLEAN), priority (1-3), tag (TEXT), created_at. init_db.py.',
      priority: 100, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [],
    },
    {
      title: 'CRUD endpoints — GET/POST/PATCH/DELETE /todos',
      description: 'Full REST CRUD. Pydantic models. 404 on missing ID. Filter by done/tag via query params.',
      priority: 90, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [0],
    },
    {
      title: 'Pytest suite — all endpoints',
      description: 'Create, list, update, delete, filter. Happy path + errors (404, validation). In-memory DB fixture.',
      priority: 80, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [1],
    },
  ],
}

const AUTH_SERVICE: ProjectTemplate = {
  id: 'auth-service',
  level: 3,
  label: 'Auth Service + Protected UI',
  description: 'JWT auth backend (register/login) + React login form and protected dashboard. Two bots, parallel then converge.',
  why: 'Tests parallel bots that must coordinate: backend bot builds API, UI bot builds forms, both merge at integration test.',
  tech_stack: 'FastAPI + React + TypeScript + JWT',
  mission_name: 'Build Auth Service',
  mission_description: 'JWT authentication: register, login, protected routes. Backend and frontend developed in parallel.',
  mission_success_criteria: 'Register creates user. Login returns JWT. Protected /me endpoint requires valid token. React login form authenticates and shows dashboard.',
  mission_tech_notes: 'Backend: FastAPI + python-jose + passlib + sqlite3. Frontend: React 18 + TypeScript + Tailwind. JWT stored in localStorage. CORS configured for localhost:5173.',
  model_hint: 'claude-sonnet-4-6',
  agents: 2,
  tags: ['level-3', 'fullstack', 'multi-bot', 'parallel', 'auth', 'jwt'],
  tasks: [
    {
      title: 'Backend: User model + DB schema',
      description: 'users table: id (TEXT PK), email (UNIQUE), hashed_password, created_at. Password hashing with passlib/bcrypt. init_db.py.',
      priority: 100, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [],
    },
    {
      title: 'Backend: Register + Login endpoints',
      description: 'POST /auth/register (email, password). POST /auth/login returns {access_token, token_type}. JWT signed with secret key (from env). 400 on duplicate email, 401 on bad credentials.',
      priority: 90, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [0],
    },
    {
      title: 'Backend: JWT middleware + protected /me endpoint',
      description: 'Dependency that validates Bearer token. GET /me returns current user. 401 on invalid/expired token.',
      priority: 80, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [1],
    },
    {
      title: 'Frontend: Login + Register forms',
      description: 'React 18 + Tailwind. Two forms: login and register. Client-side validation. On success store JWT in localStorage. useAuth hook.',
      priority: 90, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [],
    },
    {
      title: 'Frontend: Protected dashboard page',
      description: 'Route /dashboard requires auth — redirect to /login if no token. Calls GET /me to show user info. Logout clears token.',
      priority: 80, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [3],
    },
    {
      title: 'Integration tests — full auth flow',
      description: 'Pytest: register → login → use token on /me → logout (delete token). Also test React components with vitest + testing-library.',
      priority: 70, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [2, 4],
    },
  ],
}

const DISCORD_BOT: ProjectTemplate = {
  id: 'discord-bot',
  level: 3,
  label: 'Discord Bot',
  description: 'Feature-rich Discord bot: commands, a SQLite user DB, and an admin panel. Two bots — bot logic and admin web UI.',
  why: 'Tests parallel bots on different concerns: one builds the Discord integration, one builds a local admin dashboard.',
  tech_stack: 'Python + discord.py + FastAPI',
  mission_name: 'Build Discord Bot',
  mission_description: 'Discord bot with slash commands, user data persistence, and a local admin web interface.',
  mission_success_criteria: 'Bot connects and responds to /ping. User XP tracked in DB. /leaderboard command works. Admin web panel shows stats.',
  mission_tech_notes: 'discord.py 2.x. SQLite for user data. FastAPI for admin panel on port 8080. Python 3.11+. Use environment variables for bot token.',
  model_hint: 'claude-sonnet-4-6',
  agents: 2,
  tags: ['level-3', 'python', 'discord', 'multi-bot', 'parallel'],
  tasks: [
    {
      title: 'Bot setup + basic commands',
      description: 'discord.py 2.x app_commands. /ping replies with latency. /help lists all commands. Load token from .env. Logging setup.',
      priority: 100, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [],
    },
    {
      title: 'User DB + XP system',
      description: 'users table: discord_id, username, xp, level, joined_at. Award XP on each message. Level-up notification. /rank command shows user stats.',
      priority: 90, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [0],
    },
    {
      title: '/leaderboard + /stats commands',
      description: '/leaderboard shows top 10 users by XP as a formatted embed. /stats shows server-wide stats (total members, messages, avg XP).',
      priority: 80, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [1],
    },
    {
      title: 'Admin web panel — FastAPI',
      description: 'FastAPI app on port 8080. GET /stats returns JSON of all users sorted by XP. GET /users/{id} returns one user. Static HTML page at / showing a live leaderboard table.',
      priority: 90, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [],
    },
    {
      title: 'Integration + tests',
      description: 'pytest for DB operations (XP award, level-up logic). pytest for admin API endpoints. Mock discord.py where needed.',
      priority: 70, runner_type: 'claude_code', model_hint: 'claude-haiku-4-5-20251001',
      depends_on_index: [2, 3],
    },
  ],
}

// ── Level 4: Multi-bot, multi-phase, 7-9 tasks ─────────────────────────────

const SELF_BUILD: ProjectTemplate = {
  id: 'self-build-feature',
  level: 4,
  label: 'BotMaster Feature Sprint',
  description: 'Use BotMaster to build a new BotMaster feature. Multi-bot: backend bot + UI bot + test bot.',
  why: 'Ultimate dogfood test. Validates multi-bot coordination, question escalation, review flow.',
  tech_stack: 'FastAPI + React + TypeScript + Tailwind',
  mission_name: 'Add Cost Analytics to BotMaster',
  mission_description: 'New hub endpoint aggregating token costs by model/project/day. New UI tab with spend charts.',
  mission_success_criteria: 'GET /api/analytics/costs returns correct aggregates. Dashboard chart renders. All tests pass.',
  mission_tech_notes: 'Hub: FastAPI, extend main.py. UI: React + Recharts. Bot events are source of truth for costs.',
  model_hint: 'claude-sonnet-4-6',
  agents: 3,
  tags: ['level-4', 'meta', 'multi-bot', 'dogfood'],
  tasks: [
    {
      title: 'Hub: /api/analytics/costs endpoint',
      description: 'Aggregate bot_events by model and project_id. Return [{model, project_id, total_tokens, est_cost_usd, day}].',
      priority: 100, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [],
    },
    {
      title: 'Hub: tests for analytics endpoint',
      description: 'Pytest: insert bot_events, call /api/analytics/costs, assert aggregations correct.',
      priority: 90, runner_type: 'claude_code', model_hint: 'claude-haiku-4-5-20251001',
      depends_on_index: [0],
    },
    {
      title: 'UI: CostAnalytics component',
      description: 'Recharts bar chart: tokens by model per day. Donut: free vs paid split. Data from /api/analytics/costs.',
      priority: 90, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [0],
    },
    {
      title: 'UI: Wire CostAnalytics into Dashboard',
      description: 'Add "Costs" tab to DashboardPage. Render CostAnalytics. Add useAnalyticsCosts hook.',
      priority: 80, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [2],
    },
  ],
}

const ECOMMERCE_API: ProjectTemplate = {
  id: 'ecommerce-api',
  level: 4,
  label: 'E-Commerce Platform',
  description: 'Full e-commerce: product catalogue API, cart + orders, React storefront, admin dashboard. Three bots, two parallel tracks merging at integration.',
  why: 'Tests long parallel chains that must converge: backend track (schema→CRUD→orders→payment stub) runs alongside frontend track (listing→cart→checkout), both feed into integration tests.',
  tech_stack: 'FastAPI + React + TypeScript + SQLite',
  mission_name: 'Build E-Commerce Platform',
  mission_description: 'Product catalogue, cart, orders, and a React storefront. Backend and frontend developed in parallel by separate bots.',
  mission_success_criteria: 'Products CRUD works. Cart adds/removes items. Order creates from cart. React storefront shows products and completes a checkout flow. Full test suite passes.',
  mission_tech_notes: 'Backend: FastAPI + pydantic v2 + sqlite3. Frontend: React 18 + TypeScript + Tailwind + TanStack Query. CORS on localhost:5173. No real payment — stub returns {success: true}.',
  model_hint: 'claude-sonnet-4-6',
  agents: 3,
  tags: ['level-4', 'fullstack', 'multi-bot', 'ecommerce', 'react', 'fastapi'],
  tasks: [
    {
      title: 'Backend: DB schema — products, carts, orders',
      description: 'products (id, name, price, stock, category, image_url), cart_items (id, session_id, product_id, qty), orders (id, session_id, total, status, created_at), order_items (order_id, product_id, qty, unit_price). init_db.py + seed 10 products.',
      priority: 100, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [],
    },
    {
      title: 'Backend: Products API — GET/POST/PATCH/DELETE',
      description: 'Full product CRUD. Filter by category via ?category=. Pydantic models. 404 on missing. Decrement stock on order.',
      priority: 90, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [0],
    },
    {
      title: 'Backend: Cart + Orders API',
      description: 'Cart: POST /cart (session_id, product_id, qty), GET /cart/{session_id}, DELETE /cart/{session_id}/{item_id}. Orders: POST /orders creates order from cart, clears cart, returns order with items.',
      priority: 80, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [1],
    },
    {
      title: 'Backend: Payment stub + order status',
      description: 'POST /orders/{id}/pay — always returns {success: true, transaction_id: uuid}. Updates order status to "paid". GET /orders/{id} returns full order with items.',
      priority: 70, runner_type: 'claude_code', model_hint: 'claude-haiku-4-5-20251001',
      depends_on_index: [2],
    },
    {
      title: 'Frontend: Product listing page',
      description: 'React 18 + Tailwind + TanStack Query. Grid of product cards (image, name, price, Add to Cart button). Category filter tabs. useProducts hook fetching from API.',
      priority: 90, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [0],
    },
    {
      title: 'Frontend: Cart sidebar + checkout flow',
      description: 'Slide-out cart showing items, quantities, total. Remove item button. Checkout button POSTs to /orders then /orders/{id}/pay. Show confirmation screen.',
      priority: 80, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [4],
    },
    {
      title: 'Frontend: Order history + admin product view',
      description: 'GET /orders/{session_id} shows past orders. Simple admin page (no auth) at /admin listing all products with stock levels, edit price inline.',
      priority: 70, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [5],
    },
    {
      title: 'Integration tests — backend + E2E flow',
      description: 'Pytest: create product → add to cart → create order → pay → check stock decremented. Also vitest smoke tests for React components. All 8 previous tasks must be done.',
      priority: 60, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [3, 6],
    },
  ],
}

const REALTIME_CHAT: ProjectTemplate = {
  id: 'realtime-chat',
  level: 4,
  label: 'Real-Time Chat App',
  description: 'WebSocket chat server + React chat UI. Rooms, history, typing indicators, user presence. Three bots, backend → frontend → polish.',
  why: 'Tests long chain with real-time complexity: WebSocket state, presence tracking, message persistence, and a polished UI all coordinated across bots.',
  tech_stack: 'FastAPI + WebSockets + React + TypeScript',
  mission_name: 'Build Real-Time Chat',
  mission_description: 'Multi-room chat. Users join rooms, send messages, see who is online, see typing indicators.',
  mission_success_criteria: 'Two browser tabs can chat in real time. Message history loads on join. Typing indicator appears. User list shows who is online.',
  mission_tech_notes: 'Backend: FastAPI + WebSockets + sqlite3 for message history. Frontend: React 18 + TypeScript + Tailwind. No auth — username chosen on join. Use uuid4 for user IDs.',
  model_hint: 'claude-sonnet-4-6',
  agents: 3,
  tags: ['level-4', 'fullstack', 'multi-bot', 'websocket', 'realtime', 'react'],
  tasks: [
    {
      title: 'Backend: WebSocket connection manager + rooms',
      description: 'ConnectionManager class: connect, disconnect, broadcast_to_room, broadcast_all. In-memory room registry. WS endpoint /ws/{room}/{username}. Log connect/disconnect events.',
      priority: 100, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [],
    },
    {
      title: 'Backend: Message persistence + history API',
      description: 'messages table: id, room, username, content, created_at. On each message received: persist then broadcast. GET /rooms/{room}/history?limit=50 returns recent messages.',
      priority: 90, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [0],
    },
    {
      title: 'Backend: Presence + typing events',
      description: 'Track online users per room (in-memory). Send {type:"presence", users:[...]} on join/leave. Handle {type:"typing"} from client — broadcast to room except sender. GET /rooms/{room}/users returns online list.',
      priority: 80, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [1],
    },
    {
      title: 'Frontend: Chat UI shell + WebSocket hook',
      description: 'React 18 + Tailwind. useWebSocket hook wrapping native WebSocket. Auto-reconnect on disconnect. Message send function. Room and username from URL params (/chat/:room).',
      priority: 90, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [],
    },
    {
      title: 'Frontend: Message list + history load',
      description: 'Scrollable message list, auto-scroll to bottom on new message. On connect: fetch /rooms/{room}/history and prepend. Message bubbles: own messages right-aligned.',
      priority: 80, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [3],
    },
    {
      title: 'Frontend: Presence sidebar + typing indicator',
      description: 'Right sidebar listing online users with green dot. Show "Alice is typing…" below message input when typing event received. Debounce typing events (emit on keydown, stop after 2s).',
      priority: 70, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [4],
    },
    {
      title: 'Room picker landing page + integration tests',
      description: 'Home page: enter username + room name → navigate to /chat/:room. Vitest + testing-library for WS hook mock. Playwright E2E: two users send messages, both see them.',
      priority: 60, runner_type: 'claude_code', model_hint: 'claude-sonnet-4-6',
      depends_on_index: [2, 5],
    },
  ],
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  // Level 1
  HELLO_API,
  CLI_TOOL,
  LANDING_PAGE,
  // Level 2
  PORTFOLIO,
  NOTES_API,
  BLOG_SITE,
  // Level 3
  TODO_APP,
  AUTH_SERVICE,
  DISCORD_BOT,
  // Level 4
  SELF_BUILD,
  ECOMMERCE_API,
  REALTIME_CHAT,
]

// Compute the longest sequential dependency chain depth for a template
export function chainDepth(tasks: TaskTemplate[]): number {
  if (tasks.length === 0) return 0
  const depths: number[] = new Array(tasks.length).fill(0)
  for (let i = 0; i < tasks.length; i++) {
    depths[i] = tasks[i].depends_on_index.length === 0
      ? 1
      : Math.max(...tasks[i].depends_on_index.map(j => depths[j])) + 1
  }
  return Math.max(...depths)
}

// Count tasks that can run in parallel (same chain depth, no direct dependency)
export function parallelWidth(tasks: TaskTemplate[]): number {
  if (tasks.length === 0) return 0
  const depths: number[] = new Array(tasks.length).fill(0)
  for (let i = 0; i < tasks.length; i++) {
    depths[i] = tasks[i].depends_on_index.length === 0
      ? 1
      : Math.max(...tasks[i].depends_on_index.map(j => depths[j])) + 1
  }
  const freq: Record<number, number> = {}
  depths.forEach(d => { freq[d] = (freq[d] ?? 0) + 1 })
  return Math.max(...Object.values(freq))
}
