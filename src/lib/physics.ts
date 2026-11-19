export type Point = { x: number; z: number }

export type RayResult = {
  points: Point[]
  travelTime: number
  end: Point
  turned: boolean
}

export type BeamResult = {
  angle: number
  trueHit: Point
  estimatedHit: Point
  travelTime: number
}

export const SOURCE_DEPTH = 5
export const BOTTOM_DEPTH = 100
export const DZ = 0.02
export const SURFACE_SPEED = 1480

export function profileSpeed(gradient: number, depth: number, surfaceSpeed = SURFACE_SPEED) {
  return surfaceSpeed + gradient * depth
}

export function traceToDepth(
  angleDegrees: number,
  gradient: number,
  targetDepth = BOTTOM_DEPTH,
  step = DZ,
): RayResult {
  const direction = Math.sign(angleDegrees) || 1
  const launchAngle = Math.abs((angleDegrees * Math.PI) / 180)
  const initialSpeed = profileSpeed(gradient, SOURCE_DEPTH)
  const rayParameter = Math.sin(launchAngle) / initialSpeed
  const points: Point[] = [{ x: 0, z: SOURCE_DEPTH }]
  let x = 0
  let z = SOURCE_DEPTH
  let travelTime = 0
  let turned = false
  let stepIndex = 0

  while (z < targetDepth) {
    const depthStep = Math.min(step, targetDepth - z)
    const speed = profileSpeed(gradient, z + depthStep / 2)
    const sine = rayParameter * speed
    if (sine >= 1) {
      turned = true
      break
    }
    const angle = Math.asin(sine)
    const cosine = Math.cos(angle)
    x += direction * Math.tan(angle) * depthStep
    travelTime += depthStep / (cosine * speed)
    z += depthStep
    stepIndex += 1
    if (stepIndex % 30 === 0 || z >= targetDepth) points.push({ x, z })
  }

  if (z < targetDepth && !turned) points.push({ x, z })
  return { points, travelTime, end: { x, z }, turned }
}

export function traceRayPath(
  angleDegrees: number,
  gradient: number,
  bottomDepth: number,
  maxHorizontalDistance: number,
  step = 2,
): RayResult {
  const halfPi = Math.PI / 2
  const launchAngle = (angleDegrees * Math.PI) / 180
  const rayParameter = Math.sin(launchAngle) / profileSpeed(gradient, SOURCE_DEPTH)
  const angleRate = rayParameter * gradient
  const points: Point[] = [{ x: 0, z: SOURCE_DEPTH }]
  let angle = launchAngle
  let x = 0
  let z = SOURCE_DEPTH
  let travelTime = 0
  let turned = false
  let stepIndex = 0

  while (x < maxHorizontalDistance) {
    const angleAtStepEnd = angle + angleRate * step
    const angleAtMidpoint = (angle + angleAtStepEnd) / 2
    const nextDepth = z + Math.cos(angleAtMidpoint) * step
    const boundaryDepth = nextDepth >= bottomDepth ? bottomDepth : nextDepth <= 0 ? 0 : null
    const previousDepth = z
    let pathStep = boundaryDepth === null ? step : step * ((boundaryDepth - z) / (nextDepth - z))
    if (boundaryDepth === null && x + Math.sin(angleAtMidpoint) * pathStep > maxHorizontalDistance) {
      pathStep = (maxHorizontalDistance - x) / Math.sin(angleAtMidpoint)
    }
    const nextAngle = angle + angleRate * pathStep
    const midpointAngle = (angle + nextAngle) / 2
    const nextX = x + Math.sin(midpointAngle) * pathStep
    const nextZ = boundaryDepth ?? z + Math.cos(midpointAngle) * pathStep
    const crossedTurn = (angle - halfPi) * (nextAngle - halfPi) < 0

    x = nextX
    z = nextZ
    travelTime += pathStep / profileSpeed(gradient, (previousDepth + z) / 2)
    angle = nextAngle
    turned ||= crossedTurn
    stepIndex += 1

    if (boundaryDepth === bottomDepth) {
      angle = Math.PI - angle
      points.push({ x, z })
    } else if (boundaryDepth === 0) {
      points.push({ x, z })
      break
    } else if (stepIndex % 10 === 0) {
      points.push({ x, z })
    }
  }

  if (points[points.length - 1].x !== x || points[points.length - 1].z !== z) points.push({ x, z })
  return { points, travelTime, end: { x, z }, turned }
}

export function traceForTime(
  angleDegrees: number,
  gradient: number,
  targetTime: number,
  step = DZ,
): RayResult {
  const direction = Math.sign(angleDegrees) || 1
  const launchAngle = Math.abs((angleDegrees * Math.PI) / 180)
  const rayParameter = Math.sin(launchAngle) / profileSpeed(gradient, SOURCE_DEPTH)
  const points: Point[] = [{ x: 0, z: SOURCE_DEPTH }]
  let x = 0
  let z = SOURCE_DEPTH
  let travelTime = 0
  let turned = false
  let stepIndex = 0

  while (travelTime < targetTime && z < 250) {
    const speed = profileSpeed(gradient, z + step / 2)
    const sine = rayParameter * speed
    if (sine >= 1) {
      turned = true
      break
    }
    const angle = Math.asin(sine)
    const cosine = Math.cos(angle)
    const timePerDepth = 1 / (cosine * speed)
    const depthStep = Math.min(step, (targetTime - travelTime) / timePerDepth)
    x += direction * Math.tan(angle) * depthStep
    z += depthStep
    travelTime += depthStep * timePerDepth
    stepIndex += 1
    if (stepIndex % 30 === 0 || travelTime >= targetTime) points.push({ x, z })
  }

  return { points, travelTime, end: { x, z }, turned }
}

export function simulateBeams(trueGradient: number, measuredGradient = 0): BeamResult[] {
  const results: BeamResult[] = []
  for (let angle = -60; angle <= 60; angle += 5) {
    const truth = traceToDepth(angle, trueGradient)
    const estimate = traceForTime(angle, measuredGradient, truth.travelTime)
    results.push({
      angle,
      trueHit: truth.end,
      estimatedHit: estimate.end,
      travelTime: truth.travelTime * 2,
    })
  }
  return results
}

export function quadraticInterpolation(points: Point[], sampleCount = 180): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x)
  if (sorted.length < 3) return sorted
  const output: Point[] = []
  const minX = sorted[0].x
  const maxX = sorted[sorted.length - 1].x
  for (let sample = 0; sample <= sampleCount; sample += 1) {
    const x = minX + ((maxX - minX) * sample) / sampleCount
    let nearest = 0
    for (let index = 1; index < sorted.length; index += 1) {
      if (Math.abs(sorted[index].x - x) < Math.abs(sorted[nearest].x - x)) nearest = index
    }
    const start = Math.max(0, Math.min(sorted.length - 3, nearest - 1))
    const triple = sorted.slice(start, start + 3)
    const z = triple.reduce((sum, point, index) => {
      const [a, b] = triple.filter((_, other) => other !== index)
      const denominator = (point.x - a.x) * (point.x - b.x)
      if (Math.abs(denominator) < 1e-9) return sum
      return sum + point.z * ((x - a.x) * (x - b.x)) / denominator
    }, 0)
    output.push({ x, z })
  }
  return output
}

export function errorMetrics(beams: BeamResult[]) {
  const errors = beams.map((beam) => {
    const error = beam.estimatedHit.z - beam.trueHit.z
    return Math.abs(error) < 1e-9 ? 0 : error
  })
  const absolute = errors.map(Math.abs)
  const rms = Math.sqrt(errors.reduce((sum, error) => sum + error * error, 0) / errors.length)
  const outer = beams.filter((beam) => Math.abs(beam.angle) >= 55).map((beam) => Math.abs(beam.estimatedHit.z - beam.trueHit.z))
  return {
    max: Math.max(...absolute),
    mean: absolute.reduce((sum, error) => sum + error, 0) / absolute.length,
    rms,
    outer: outer.reduce((sum, error) => sum + error, 0) / outer.length,
  }
}

export function angleFromInvariant(rayParameter: number, speed: number) {
  return Math.asin(Math.min(0.99999, Math.max(-0.99999, rayParameter * speed))) * (180 / Math.PI)
}