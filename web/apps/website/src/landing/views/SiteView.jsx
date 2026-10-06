import Hero from '../components/Hero.jsx'
import Marquee from '../components/Marquee.jsx'
import Features from '../components/Features.jsx'
import DemoSection from '../components/DemoSection.jsx'
import Specialties from '../components/Specialties.jsx'
import FreeSite from '../components/FreeSite.jsx'
import { Testimonial, Cta } from '../components/Closing.jsx'

export default function SiteView({ onRegister, onSignIn }) {
  return (
    <>
      <Hero onRegister={onRegister} />
      <Marquee />
      <Features />
      <DemoSection />
      <Specialties />
      <FreeSite onRegister={onRegister} />
      <Testimonial />
      <Cta onRegister={onRegister} onSignIn={onSignIn} />
    </>
  )
}
