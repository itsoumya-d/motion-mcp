import { Activity, Code2, CreditCard, Layers3, Sparkles } from "lucide-react";

const tools = [
  ["scan_codebase", "Detect frameworks, components, and animation libraries."],
  ["research_app_motion", "Infer screens, flows, motion thesis, and high-value moments."],
  ["research_state_machine_experience", "Map every page into Rive-like layers, states, listeners, and bindings."],
  ["estimate_asset_lane", "Choose host-model SVGs for simple assets or QuiverAI for premium ones."],
  ["generate_simple_svg_asset", "Return a strict SVG brief, then ingest and validate the result."],
  ["generate_premium_svg_asset", "Use QuiverAI for high-fidelity, multi-part motion assets."],
  ["generate_animation", "Stage framework-native state-machine animation code as a diff."]
];

const targets = [
  ["React / Next.js", "Stable", "Framer Motion and GSAP-ready SVG choreography."],
  ["Expo / React Native", "Stable", "Reanimated 3 plus react-native-svg path animation."],
  ["Flutter", "Beta", "AnimationController wrappers and CustomPainter extension points."],
  ["Unity", "Beta", "Pointer state machines with DOTween-ready extension points."]
];

export default function Page() {
  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Codex and Claude Code motion layer</p>
          <h1>Make existing apps feel alive.</h1>
          <p className="lede">
            Motion MCP scans your real codebase, researches screen-by-screen motion, chooses a
            simple or premium SVG lane, and generates Rive-like host-code state machines without
            replacing your components.
          </p>
          <div className="actions">
            <a href="#tools">Explore tools</a>
            <a href="#billing" className="secondary">Credit model</a>
          </div>
        </div>
        <div className="panel motion-panel" aria-label="Motion MCP pipeline">
          <div className="node active"><Sparkles size={18} /> scan</div>
          <div className="line" />
          <div className="node"><Layers3 size={18} /> app motion map</div>
          <div className="line" />
          <div className="node"><Layers3 size={18} /> simple or premium svg</div>
          <div className="line" />
          <div className="node"><Activity size={18} /> state machine</div>
        </div>
      </section>

      <section id="tools" className="grid">
        {tools.map(([name, description]) => (
          <article key={name} className="card">
            <Code2 size={20} />
            <h2>{name}</h2>
            <p>{description}</p>
          </article>
        ))}
      </section>

      <section className="targets" aria-label="Target support">
        {targets.map(([name, status, description]) => (
          <article key={name} className="card">
            <h2>{name}</h2>
            <span className={status === "Stable" ? "status stable" : "status"}>{status}</span>
            <p>{description}</p>
          </article>
        ))}
      </section>

      <section id="billing" className="billing">
        <CreditCard size={22} />
        <div>
          <h2>Subscriptions plus topups</h2>
          <p>
            Motion MCP keeps the QuiverAI key server-side, uses the host model for low-cost simple
            SVGs, reserves credits before premium generation, and commits charges only after a usable
            SVG or animation diff is staged.
          </p>
        </div>
      </section>
    </main>
  );
}
