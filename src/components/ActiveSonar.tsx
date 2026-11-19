import { useMemo, useState } from 'react'
import { Activity, AudioLines, Info, Waves } from 'lucide-react'
import type { Data } from 'plotly.js'
import Chart from './Plot'
import { MAX_RANGE, soundSpeedAt, traceRayField, WATER_DEPTH } from '../lib/activeSonar'
import type { SoundSpeedPoint } from '../lib/activeSonar'
import { localizeTree } from '../lib/localization'
import type { Language } from '../lib/localization'

function TrySelfBox({ language }: { language: Language }) {
  return (
    <aside className="try-self-box">
      <Info size={17} strokeWidth={1.8} />
      <div>
        <h3>{language === 'en' ? 'Try it yourself' : 'Prøv selv'}</h3>
        <p>{language === 'en'
          ? 'Move the sonar depth through and outside the sound channel. Compare the ray coverage at 200 m with depths above or below it, and explain why the submarine is visible only in some positions.'
          : 'Flytt sonardybden gjennom og utenfor lydkanalen. Sammenlign stråledekningen rundt 200 m med dybder over eller under kanalen, og forklar hvorfor ubåten bare blir synlig i noen posisjoner.'}</p>
      </div>
    </aside>
  )
}

const DEEP_CHANNEL_MIN = 180
const DEEP_CHANNEL_MAX = 220
const SURFACE_DUCT_MAX_DEPTH = 60
const SURFACE_DUCT_CENTER_DEPTH = 30
const TARGET_RANGE = 10500
const TARGET_DEPTH = 200
const PROFILE = [
  { depth: 0, speed: 1502 },
  { depth: 20, speed: 1508 },
  { depth: 40, speed: 1515 },
  { depth: 60, speed: 1522 },
  { depth: 90, speed: 1518 },
  { depth: 120, speed: 1512 },
  { depth: 160, speed: 1500 },
  { depth: 200, speed: 1494 },
  { depth: 230, speed: 1498 },
  { depth: 280, speed: 1507 },
  { depth: 350, speed: 1515 },
  { depth: 420, speed: 1520 },
  { depth: 500, speed: 1525 },
] satisfies SoundSpeedPoint[]

function Submarine({ detected }: { detected: boolean }) {
  return (
    <svg viewBox="0 0 100 36" aria-hidden="true" className={`asw-submarine ${detected ? 'is-detected' : ''}`}>
      <path d="M8 21c7-8 22-11 55-9l17 3 12 6-12 6-17 3c-33 2-48-1-55-9Z" fill="currentColor" />
      <path d="M42 11V5h15v8m-8-8V2h5v3M4 16v10m-3-7h6m-2-3v10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="74" cy="19" r="1.7" fill="white" />
    </svg>
  )
}

export default function ActiveSonar({ language }: { language: Language }) {
  const [sonarDepth, setSonarDepth] = useState(200)
  const detected = sonarDepth >= DEEP_CHANNEL_MIN && sonarDepth <= DEEP_CHANNEL_MAX
  const detectionHint = language === 'en'
    ? `The submarine appears when the sonar is between ${DEEP_CHANNEL_MIN} and ${DEEP_CHANNEL_MAX} m.`
    : `Ubåten vises når sonaren er mellom ${DEEP_CHANNEL_MIN} og ${DEEP_CHANNEL_MAX} m.`
  const field = useMemo(() => traceRayField(PROFILE, 'cubic', sonarDepth), [sonarDepth])
  const profileDepths = useMemo(() => Array.from({ length: 251 }, (_, index) => index * 2), [])
  const displayedRays = field.rays.slice(15, 46)
  const profileTraces: Data[] = [
    {
      x: profileDepths.map((depth) => soundSpeedAt(PROFILE, depth, 'cubic')),
      y: profileDepths,
      mode: 'lines',
      name: language === 'en' ? 'Sound speed' : 'Lydhastighet',
      line: { color: '#3976b8', width: 3 },
      hovertemplate: language === 'en'
        ? 'Sound speed %{x:.1f} m/s<br>Depth %{y:.0f} m<extra></extra>'
        : 'Lydhastighet %{x:.1f} m/s<br>Dybde %{y:.0f} m<extra></extra>',
    },
    {
      x: [
        soundSpeedAt(PROFILE, SURFACE_DUCT_CENTER_DEPTH, 'cubic'),
        soundSpeedAt(PROFILE, TARGET_DEPTH, 'cubic'),
      ],
      y: [SURFACE_DUCT_CENTER_DEPTH, TARGET_DEPTH],
      mode: 'markers+text',
      name: language === 'en' ? 'Channels' : 'Kanaler',
      marker: { color: ['#db654f', '#2e8b57'], size: 9, symbol: 'diamond' },
      text: language === 'en'
        ? ['Surface duct · 30 m', 'Sound channel · 200 m']
        : ['Overflatekanal · 30 m', 'Lydkanal · 200 m'],
      textposition: 'middle right',
      textfont: { size: 9, color: '#28252c' },
      hoverinfo: 'skip',
    },
  ]
  const rayTrace: Data = {
    x: displayedRays.flatMap((ray, index) => index === 0 ? ray.x : [NaN, ...ray.x]),
    y: displayedRays.flatMap((ray, index) => index === 0 ? ray.z : [NaN, ...ray.z]),
    mode: 'lines',
    name: language === 'en' ? 'Rays' : 'Stråler',
    line: { color: 'rgba(40,37,44,0.42)', width: 1.15 },
    hoverinfo: 'skip',
  }
  const rayBoundaries: Data[] = [
    { x: [0, MAX_RANGE], y: [0, 0], mode: 'lines', name: language === 'en' ? 'Sea surface' : 'Havoverflate', line: { color: '#3976b8', width: 2 } },
    { x: [0, MAX_RANGE], y: [WATER_DEPTH, WATER_DEPTH], mode: 'lines', name: language === 'en' ? 'Seafloor' : 'Havbunn', line: { color: '#28252c', width: 2 } },
    { x: [0], y: [sonarDepth], mode: 'markers', name: 'Sonar', marker: { color: '#7800f0', size: 11, symbol: 'diamond' }, hovertemplate: language === 'en' ? 'Sonar<br>Depth %{y:.0f} m<extra></extra>' : 'Sonar<br>Dybde %{y:.0f} m<extra></extra>' },
  ]

  return localizeTree((
    <section id="asw" className="lesson-section sonar-section asw-section">
      <div className="asw-heading">
        <div className="section-index">08</div>
        <div>
          <span className="eyebrow">{language === 'en' ? 'ACTIVE SONAR · ASW' : 'AKTIV SONAR · ASW'}</span>
          <h2>{language === 'en' ? 'Place the sonar in the sound channel' : 'Plasser sonaren i lydkanalen'}</h2>
          <p>{language === 'en'
            ? 'Sound channels guide sound through the water column. The sound-speed profile below shows both a surface duct and a sound channel centered at 200 m. Change the sonar depth and follow the ray paths.'
            : 'Lydkanaler kanaliserer lyden i vannsøylen. Lydhastighetsprofilen under viser både en overflatekanal og en lydkanal med sentrum ved 200 m. Endre sonardybden og følg strålebanene.'}</p>
        </div>
        <div className={`asw-status ${detected ? 'detected' : 'not-detected'}`} aria-live="polite">
          <span />{detected
            ? (language === 'en' ? 'SUBMARINE DETECTED' : 'UBÅT DETEKTERT')
            : (language === 'en' ? 'SUBMARINE NOT VISIBLE' : 'UBÅT IKKE SYNLIG')}
        </div>
      </div>

      <aside className="asw-theory" aria-label={language === 'en' ? 'Sound channel theory' : 'Teori om lydkanaler'}>
        <div>
          <h3>{language === 'en' ? 'Sound channel' : 'Lydkanal'}</h3>
          <p>{language === 'en'
            ? 'A sound channel is a layer of water where sound speed is lower than both above and below it. Sound rays bend toward the region of lower sound speed and are therefore kept together around the channel axis. This can allow sound to travel long distances, although how well the channel works depends on the sound-speed profile. The sound channel in the profile below is centered at 200 m.'
            : 'En lydkanal er et lag i vannet der lydhastigheten er lavere enn over og under laget. Lydstråler bøyes mot området med lavere lydhastighet og holdes derfor samlet rundt kanalens akse. Lyden kan på den måten forplante seg langt, men hvor godt kanalen virker, avhenger av lydhastighetsprofilen. Lydkanalen i profilen nedenfor har sentrum ved 200 m.'}</p>
        </div>
        <div>
          <h3>{language === 'en' ? 'Surface duct' : 'Overflatekanal'}</h3>
          <p>{language === 'en'
            ? 'A surface duct is a sound-carrying layer near the sea surface. The sound-speed profile bends sound rays back toward the layer, while reflections at the sea surface help keep sound in the duct. In the profile below, sound speed increases from a minimum at the surface to a maximum at 60 m, which marks the edge of the surface duct.'
            : 'En overflatekanal er et lydførende lag nær havoverflaten. Lydstrålene bøyes tilbake mot laget av lydhastighetsprofilen, mens refleksjoner i havoverflaten bidrar til å holde lyden i kanalen. I profilen nedenfor øker lydhastigheten fra et minimum ved overflaten til et maksimum ved 60 m, som avgrenser overflatekanalen.'}</p>
        </div>
      </aside>

      <TrySelfBox language={language} />

      <div className="asw-depth-control">
        <label htmlFor="asw-sonar-depth">{language === 'en' ? 'Sonar depth' : 'Sonardybde'}</label>
        <strong>{sonarDepth} <small>m</small></strong>
        <input id="asw-sonar-depth" type="range" min="10" max="450" step="1" value={sonarDepth} onChange={(event) => setSonarDepth(Number(event.currentTarget.value))} aria-describedby="asw-depth-hint" />
        <span className="asw-slider-marks"><span>10 m</span><span>450 m</span></span>
        <p id="asw-depth-hint">{detectionHint}</p>
      </div>

      <div className="asw-grid">
        <section className="module-frame sonar-panel">
          <div className="module-header"><div><span className="eyebrow">{language === 'en' ? 'FIXED SSP' : 'FAST SSP'}</span><h3>{language === 'en' ? 'Two sound channels in the water column' : 'To lydkanaler i vannsøylen'}</h3></div><Waves size={17} /></div>
          <div className="chart-area asw-profile-chart">
            <Chart data={profileTraces} layout={{
              margin: { l: 56, r: 18, t: 20, b: 48 },
              xaxis: { title: language === 'en' ? 'Sound speed (m/s)' : 'Lydhastighet (m/s)', range: [1490, 1530] },
              yaxis: { title: language === 'en' ? 'Depth (m)' : 'Dybde (m)', range: [WATER_DEPTH, 0] },
              showlegend: false,
              shapes: [
                { type: 'rect', xref: 'paper', x0: 0, x1: 1, y0: 0, y1: SURFACE_DUCT_MAX_DEPTH, fillcolor: 'rgba(219,101,79,0.10)', line: { width: 0 }, layer: 'below' },
                { type: 'rect', xref: 'paper', x0: 0, x1: 1, y0: DEEP_CHANNEL_MIN, y1: DEEP_CHANNEL_MAX, fillcolor: 'rgba(46,139,87,0.12)', line: { width: 0 }, layer: 'below' },
              ],
            }} />
          </div>
          <div className="asw-legend"><span><i className="surface-channel-dot" /> {language === 'en' ? 'Surface duct · max. 60 m' : 'Overflatekanal · maks. 60 m'}</span><span><i className="deep-channel-dot" /> {language === 'en' ? 'Sound channel · 200 m' : 'Lydkanal · 200 m'}</span></div>
        </section>

        <section className="module-frame sonar-panel">
          <div className="module-header"><div><span className="eyebrow">{language === 'en' ? 'RAY PLOT · 15 KM' : 'STRÅLEPLOTT · 15 KM'}</span><h3>{language === 'en' ? 'Ray paths from selected sonar depth' : 'Strålegang fra valgt sonardybde'}</h3></div><Activity size={17} /></div>
          <div className="chart-area asw-ray-chart">
            <Chart data={[rayTrace,