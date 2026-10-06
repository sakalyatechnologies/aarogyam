const ITEMS = [
  'General dentistry',
  'Orthodontics',
  'Implantology',
  'Dermatology',
  'Pediatrics',
  'Physiotherapy',
  'Ayurveda',
  'Ophthalmology',
]

export default function Marquee() {
  const row = (key) => (
    <span key={key} style={{ display: 'contents' }}>
      {ITEMS.map((t) => (
        <span key={key + t}>
          <b>✦</b> {t}
        </span>
      ))}
    </span>
  )
  return (
    <div className="marquee">
      <div className="mq-track">
        {row('a')}
        {row('b')}
      </div>
    </div>
  )
}
