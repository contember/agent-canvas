export default function Plan() {
  // ── Custom interactive component: Story Point Estimator ──
  function StoryPointEstimator() {
    const [votes, setVotes] = React.useState({});
    const fibValues = [1, 2, 3, 5, 8, 13, 21];
    const team = ["Alice", "Bob", "Carol"];

    const allVoted = team.every((m) => votes[m] !== undefined);
    const avg = allVoted
      ? (team.reduce((s, m) => s + votes[m], 0) / team.length).toFixed(1)
      : null;
    const spread = allVoted
      ? Math.max(...team.map((m) => votes[m])) - Math.min(...team.map((m) => votes[m]))
      : null;

    return (
      <div className="my-4 rounded-xl border border-border-subtle bg-bg-elevated p-5">
        <h3 className="font-heading text-[15px] text-text-primary mb-1">Planning Poker</h3>
        <p className="text-[12px] text-text-tertiary mb-4">Click cards to cast each team member's estimate.</p>
        <div className="space-y-3">
          {team.map((member) => (
            <div key={member}>
              <span className="text-[12px] font-body font-medium text-text-secondary">{member}</span>
              <div className="flex gap-1.5 mt-1">
                {fibValues.map((v) => (
                  <button
                    key={v}
                    onClick={() => setVotes((prev) => ({ ...prev, [member]: v }))}
                    className={`w-9 h-11 rounded-lg text-[13px] font-mono font-semibold transition-all duration-150 border ${
                      votes[member] === v
                        ? "bg-accent-amber text-text-inverse border-accent-amber scale-110 shadow-md"
                        : "bg-bg-base text-text-secondary border-border-subtle hover:border-border-hover hover:bg-bg-input"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        {allVoted && (
          <div className="mt-4 pt-3 border-t border-border-subtle flex items-center gap-6">
            <div>
              <span className="text-[11px] text-text-tertiary uppercase tracking-wider">Average</span>
              <span className="ml-2 text-[18px] font-mono font-bold text-accent-amber">{avg}</span>
            </div>
            <div>
              <span className="text-[11px] text-text-tertiary uppercase tracking-wider">Spread</span>
              <span className={`ml-2 text-[18px] font-mono font-bold ${spread > 5 ? "text-accent-red" : "text-accent-green"}`}>{spread}</span>
            </div>
            {spread > 5 && (
              <span className="text-[12px] text-accent-red font-body">High variance — discuss before finalizing!</span>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Custom interactive component: Pro/Con List ──
  function ProConList() {
    const [pros, setPros] = React.useState(["Type-safe JSX components", "Live reload in browser"]);
    const [cons, setCons] = React.useState(["Requires Bun runtime"]);
    const [newPro, setNewPro] = React.useState("");
    const [newCon, setNewCon] = React.useState("");

    const score = pros.length - cons.length;
    useFeedback(
      "pro-con-analysis",
      `## Pro/Con Analysis\n\n**Pros (${pros.length}):**\n${pros.map(p => `- ${p}`).join("\n")}\n\n**Cons (${cons.length}):**\n${cons.map(c => `- ${c}`).join("\n")}\n\n**Score:** ${score > 0 ? "+" : ""}${score}`,
      { label: "Pro/Con Analysis" },
    );

    const addPro = () => { if (newPro.trim()) { setPros([...pros, newPro.trim()]); setNewPro(""); } };
    const addCon = () => { if (newCon.trim()) { setCons([...cons, newCon.trim()]); setNewCon(""); } };

    return (
      <div className="my-4 rounded-xl border border-border-subtle bg-bg-elevated p-5">
        <h3 className="font-heading text-[15px] text-text-primary mb-4">Pro / Con Analysis</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-[12px] font-body font-semibold text-accent-green uppercase tracking-wider mb-2">Pros</div>
            <ul className="space-y-1.5">
              {pros.map((p, i) => (
                <li key={i} className="flex items-start gap-2 group">
                  <span className="text-accent-green mt-0.5 flex-shrink-0">+</span>
                  <span className="text-[13px] font-body text-text-secondary flex-1">{p}</span>
                  <button onClick={() => setPros(pros.filter((_, j) => j !== i))} className="text-text-disabled hover:text-accent-red opacity-0 group-hover:opacity-100 text-[11px] transition-opacity">remove</button>
                </li>
              ))}
            </ul>
            <div className="flex gap-1 mt-2">
              <input
                value={newPro}
                onChange={(e) => setNewPro(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addPro()}
                placeholder="Add a pro..."
                className="flex-1 bg-bg-base text-[12px] font-body text-text-primary rounded-md px-2 py-1.5 border border-border-subtle focus:outline-none focus:border-border-hover placeholder:text-text-disabled"
              />
              <button onClick={addPro} className="px-2 py-1 rounded-md bg-accent-green-muted text-accent-green text-[11px] font-body hover:opacity-80 transition-opacity">+</button>
            </div>
          </div>
          <div>
            <div className="text-[12px] font-body font-semibold text-accent-red uppercase tracking-wider mb-2">Cons</div>
            <ul className="space-y-1.5">
              {cons.map((c, i) => (
                <li key={i} className="flex items-start gap-2 group">
                  <span className="text-accent-red mt-0.5 flex-shrink-0">&minus;</span>
                  <span className="text-[13px] font-body text-text-secondary flex-1">{c}</span>
                  <button onClick={() => setCons(cons.filter((_, j) => j !== i))} className="text-text-disabled hover:text-accent-red opacity-0 group-hover:opacity-100 text-[11px] transition-opacity">remove</button>
                </li>
              ))}
            </ul>
            <div className="flex gap-1 mt-2">
              <input
                value={newCon}
                onChange={(e) => setNewCon(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addCon()}
                placeholder="Add a con..."
                className="flex-1 bg-bg-base text-[12px] font-body text-text-primary rounded-md px-2 py-1.5 border border-border-subtle focus:outline-none focus:border-border-hover placeholder:text-text-disabled"
              />
              <button onClick={addCon} className="px-2 py-1 rounded-md bg-accent-red-muted text-accent-red text-[11px] font-body hover:opacity-80 transition-opacity">+</button>
            </div>
          </div>
        </div>
        <div className="mt-3 pt-2 border-t border-border-subtle text-[11px] text-text-disabled font-body">
          Score: <span className={`font-mono font-semibold ${pros.length > cons.length ? "text-accent-green" : pros.length < cons.length ? "text-accent-red" : "text-text-tertiary"}`}>{pros.length - cons.length > 0 ? "+" : ""}{pros.length - cons.length}</span> ({pros.length} pros, {cons.length} cons)
        </div>
      </div>
    );
  }

  // ── Custom interactive component: Timeline Slider ──
  function TimelineSlider() {
    const milestones = [
      { week: 1, label: "Foundation", tasks: "Project setup, HTTP server, session management" },
      { week: 3, label: "CLI & API", tasks: "Plan API, CLI push/wait, file serving" },
      { week: 5, label: "Browser UI", tasks: "Plan renderer, annotations, response preview" },
      { week: 7, label: "Components", tasks: "Section, Task, CodeBlock, Callout, Table..." },
      { week: 9, label: "Polish", tasks: "Themes, Mermaid diagrams, markdown export" },
      { week: 11, label: "Custom Components", tasks: "Inline React components with full interactivity" },
    ];
    const [activeWeek, setActiveWeek] = React.useState(null);
    const active = milestones.find((m) => m.week === activeWeek);

    return (
      <div className="my-4 rounded-xl border border-border-subtle bg-bg-elevated p-5">
        <h3 className="font-heading text-[15px] text-text-primary mb-1">Project Timeline</h3>
        <p className="text-[12px] text-text-tertiary mb-4">Click a milestone to see details.</p>
        <div className="relative">
          {/* Track line */}
          <div className="absolute top-3 left-0 right-0 h-0.5 bg-border-medium" />
          <div className="flex justify-between relative">
            {milestones.map((m) => (
              <button
                key={m.week}
                onClick={() => setActiveWeek(activeWeek === m.week ? null : m.week)}
                className="flex flex-col items-center gap-1.5 group"
              >
                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[10px] font-mono font-bold transition-all duration-200 ${
                  activeWeek === m.week
                    ? "bg-accent-amber border-accent-amber text-text-inverse scale-125 shadow-lg"
                    : "bg-bg-base border-border-hover text-text-tertiary group-hover:border-accent-amber group-hover:text-accent-amber"
                }`}>
                  {m.week}
                </div>
                <span className={`text-[10px] font-body transition-colors whitespace-nowrap ${
                  activeWeek === m.week ? "text-accent-amber font-semibold" : "text-text-disabled group-hover:text-text-tertiary"
                }`}>
                  {m.label}
                </span>
              </button>
            ))}
          </div>
        </div>
        {active && (
          <div className="mt-4 p-3 rounded-lg bg-bg-base border border-border-subtle animate-in fade-in duration-200">
            <div className="text-[13px] font-body font-semibold text-text-primary">Week {active.week}: {active.label}</div>
            <div className="text-[12px] font-body text-text-secondary mt-1">{active.tasks}</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <Section title="Phase 1: Project Foundation">
        Set up the core infrastructure and development environment.

        <Task id="scaffolding" label="Project scaffolding" status="done">
          Create monorepo structure with daemon and CLI packages, configure Bun and TypeScript.
        </Task>

        <Task id="http-server" label="HTTP server + health endpoint" status="done">
          Bun.serve on port 19400 with routing, health check, and localhost-only binding.
        </Task>

        <Task id="session-mgmt" label="Session management" status="done">
          In-memory + filesystem persistence in ~/.planner/sessions/, history tracking, stale cleanup.
        </Task>

        <Task id="jsx-compiler" label="JSX compiler" status="done">
          Compile plan JSX fragments into ES modules using Bun.build with proper externals.
        </Task>
      </Section>

      <Section title="Phase 2: CLI & API">
        Command-line interface and REST API for plan management.

        <Task id="plan-api" label="Plan upsert API" status="done">
          POST /api/session/:id/plan, GET plan.js, GET meta, GET sessions list.
          <CodeBlock language="bash">
            curl -X POST http://localhost:19400/api/session/demo/plan \
              -H 'Content-Type: application/json' \
              -d '&#123;"jsx":"...","projectRoot":"/tmp"&#125;'
          </CodeBlock>
        </Task>

        <Task id="cli" label="CLI planner push" status="done">
          Single command that posts plan, opens browser, and blocks for feedback via WebSocket.
          <Priority level="high" />
        </Task>

        <Task id="file-serving" label="File serving endpoints" status="done">
          Serve project files with path traversal protection, directory tree listing.
        </Task>
      </Section>

      <Section title="Phase 3: Browser UI">
        React-based interactive plan viewer with annotation support.

        <Task id="plan-renderer" label="Plan renderer + live reload" status="done">
          Dynamic import of compiled plan JS, WebSocket-based live updates on plan changes.
        </Task>

        <Task id="annotations" label="Annotation layer" status="done">
          Google Docs-style text selection, popover for adding notes, sidebar for managing annotations.
          <Callout type="tip">This is the core UX differentiator — select any text to annotate it.</Callout>
        </Task>

        <Task id="response-preview" label="Response preview + submit" status="done">
          Auto-generated markdown from annotations, editable before sending, WebSocket submit.
        </Task>

        <Task id="file-browser" label="File browser" status="todo">
          Project directory tree, file preview modal, add-to-context functionality.
          <Priority level="medium" />
        </Task>
      </Section>

      <Section title="Key Files">
        <FilePreview path="daemon/src/server.ts" lines={[1, 30]} />
        <FilePreview path="daemon/client/components/Section.tsx" />
      </Section>

      <Section title="Component Library">
        Available presentation components for plan JSX.

        <Table
          headers={["Component", "Purpose", "Status"]}
          rows={[
            ["Section", "Collapsible card with heading", "Ready"],
            ["Task", "Task item with status badge", "Ready"],
            ["CodeBlock", "Syntax-highlighted code", "Ready"],
            ["Callout", "Info/warning/danger/tip box", "Ready"],
            ["FilePreview", "File content from disk", "Ready"],
            ["Mermaid", "Diagram rendering", "Ready"],
            ["Diff", "Side-by-side diff view", "Ready"],
            ["Table", "Data table", "Ready"],
            ["Checklist", "Visual checklist", "Ready"],
            ["Priority", "Priority badge", "Ready"],
            ["Note", "Aside/note block", "Ready"],
            ["Image", "Server-side image display", "Ready"]
          ]}
        />

        <Checklist items={[
          {"label": "All components implemented", "checked": true},
          {"label": "Dark mode styling", "checked": true},
          {"label": "Responsive layout", "checked": false},
          {"label": "Mermaid CDN loading", "checked": false}
        ]} />
      </Section>

      <Section title="Decisions">
        <Choice
          id="auth-approach"
          label="Which authentication approach should we use?"
          options={["JWT with refresh tokens", "Session-based with cookies", "OAuth2 with external provider", "API keys only"]}
        />

        <MultiChoice
          id="target-platforms"
          label="Which platforms should we support initially?"
          options={["Web (SPA)", "iOS", "Android", "Desktop (Electron)", "CLI"]}
        />

        <RangeInput
          id="complexity-budget"
          label="Complexity budget for the first release"
          min={1}
          max={10}
          minLabel="Minimal MVP"
          maxLabel="Full feature set"
        />

        <UserInput
          id="naming-preference"
          label="Any preference for the project name?"
          placeholder="e.g. 'Tabule', 'Planner', or leave blank for no preference"
        />
      </Section>

      <Section title="Visual Assets">
        <ImageView src="example/image.png" alt="Project screenshot" caption="Example image served from the project directory" />
      </Section>

      <Section title="Architecture Overview">
        <Note>
          The system uses a three-component architecture: CLI pushes plans to the daemon,
          which compiles JSX and serves the browser UI. Feedback flows back through WebSocket.
        </Note>

        <Mermaid>{`
          graph LR
            CC[Claude Code] -->|write| JSX[plan.jsx]
            JSX -->|planner push| D[Daemon]
            D -->|compile + serve| B[Browser]
            B -->|WebSocket submit| D
            D -->|WebSocket forward| CLI[CLI stdout]
            CLI -->|feedback| CC
            CC -->|str_replace| JSX

            style CC fill:#4a9e6d,stroke:#3a8a5a,color:#fff
            style D fill:#5a8ec4,stroke:#4a7eb4,color:#fff
            style B fill:#c49a3a,stroke:#a07820,color:#fff
            style JSX fill:#242424,stroke:#847d75,color:#e8e4df
            style CLI fill:#242424,stroke:#847d75,color:#e8e4df
        `}</Mermaid>

        <Callout type="info">
          Plans are JSX fragments — no imports or function declarations needed.
          The daemon wraps them automatically before compilation.
        </Callout>

        <Callout type="warning">
          The daemon auto-shutdown (5 min idle) is not yet implemented.
          Currently requires manual stop via 'planner daemon stop'.
        </Callout>
      </Section>

      <Section title="Custom Interactive Components">
        Plans can define custom React components inline — with full hooks, state, and interactivity.
        These are defined as functions inside the <code className="text-[12px] font-mono bg-bg-base px-1.5 py-0.5 rounded border border-border-subtle">export default</code> plan component.

        <StoryPointEstimator />
        <ProConList />
        <TimelineSlider />
      </Section>
    </>
  );
}
