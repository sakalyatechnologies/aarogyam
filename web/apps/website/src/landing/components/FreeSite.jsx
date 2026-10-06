// "Free Custom Clinic Website" spotlight — banner above Pricing.
export default function FreeSite({ onRegister }) {
  return (
    <section className="chapter" id="sec-freesite">
      <div className="wrap">
        <div className="freesite rv">
          <div className="fs-badge">COMPLIMENTARY WITH AAROGYAM</div>
          <h2>
            We build your clinic's website. <span style={{ color: 'var(--ac)' }}>Free.</span>
          </h2>
          <p>
            Most doctors don't have the time to design a website or negotiate with agencies. When
            you join Aarogyam, our team designs, customizes, and launches a modern clinic website
            for you — at zero extra cost.
          </p>
          <ul>
            <li>✓ Custom branding, logo, and clinic photos</li>
            <li>✓ Direct WhatsApp &amp; online appointment booking synced with your desk</li>
            <li>✓ Google Maps, doctor profiles, and treatment showcase</li>
            <li>✓ We work closely with you on edits until it's right</li>
          </ul>
          <button className="btn" onClick={onRegister}>
            Claim my free website →
          </button>
        </div>
      </div>
    </section>
  )
}
