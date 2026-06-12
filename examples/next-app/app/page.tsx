import Image from "next/image";
import logo from "../public/logo.svg";
import "./styles.css";

export default function Page() {
  return (
    <main className="example-shell">
      <nav>
        <Image src={logo} alt="PulseForge" width={48} height={48} />
        <span>PulseForge</span>
      </nav>
      <section>
        <h1>Fitness coaching that reacts with you.</h1>
        <p>Track workouts, streaks, recovery, and premium progress moments.</p>
        <button type="button">Start today</button>
      </section>
      <div className="pricing-card">
        <strong>Pro</strong>
        <span>$20/mo</span>
      </div>
    </main>
  );
}
