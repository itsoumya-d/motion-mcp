export function identityQuaternion(): [number, number, number, number] {
  return [0, 0, 0, 1];
}

export function degreesToRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radiansToDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function quaternionMultiply(
  a: [number, number, number, number],
  b: [number, number, number, number]
): [number, number, number, number] {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;

  return [
    ax * bw + aw * bx + ay * bz - az * by,
    ay * bw + aw * by + az * bx - ax * bz,
    az * bw + aw * bz + ax * by - ay * bx,
    aw * bw - ax * bx - ay * by - az * bz
  ];
}

export function quaternionInverse(q: [number, number, number, number]): [number, number, number, number] {
  const [x, y, z, w] = q;
  const sqNorm = x * x + y * y + z * z + w * w;
  if (sqNorm === 0) return [0, 0, 0, 1];
  return [-x / sqNorm, -y / sqNorm, -z / sqNorm, w / sqNorm];
}

export function normalizeQuaternion(q: [number, number, number, number]): [number, number, number, number] {
  const [x, y, z, w] = q;
  const len = Math.sqrt(x * x + y * y + z * z + w * w);
  if (len === 0) return [0, 0, 0, 1];
  return [x / len, y / len, z / len, w / len];
}

export function quaternionSlerp(
  a: [number, number, number, number],
  b: [number, number, number, number],
  t: number
): [number, number, number, number] {
  if (t <= 0) return a;
  if (t >= 1) return b;

  let [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;

  let cosHalfTheta = ax * bx + ay * by + az * bz + aw * bw;

  if (cosHalfTheta < 0) {
    ax = -ax;
    ay = -ay;
    az = -az;
    aw = -aw;
    cosHalfTheta = -cosHalfTheta;
  }

  if (Math.abs(cosHalfTheta) >= 1.0) {
    return [ax, ay, az, aw];
  }

  const halfTheta = Math.acos(cosHalfTheta);
  const sinHalfTheta = Math.sqrt(1.0 - cosHalfTheta * cosHalfTheta);

  if (Math.abs(sinHalfTheta) < 0.001) {
    return [
      ax * 0.5 + bx * 0.5,
      ay * 0.5 + by * 0.5,
      az * 0.5 + bz * 0.5,
      aw * 0.5 + bw * 0.5
    ];
  }

  const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
  const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;

  return [
    ax * ratioA + bx * ratioB,
    ay * ratioA + by * ratioB,
    az * ratioA + bz * ratioB,
    aw * ratioA + bw * ratioB
  ];
}

export function eulerToQuaternion(eulerDeg: [number, number, number]): [number, number, number, number] {
  const [x, y, z] = eulerDeg.map(degreesToRadians);

  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);

  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);

  // XYZ order
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3
  ];
}

export function quaternionToEuler(q: [number, number, number, number]): [number, number, number] {
  const [x, y, z, w] = q;
  
  // Roll (x-axis rotation)
  const sinr_cosp = 2 * (w * x + y * z);
  const cosr_cosp = 1 - 2 * (x * x + y * y);
  const roll = Math.atan2(sinr_cosp, cosr_cosp);

  // Pitch (y-axis rotation)
  const sinp = Math.sqrt(1 + 2 * (w * y - x * z));
  const cosp = Math.sqrt(1 - 2 * (w * y - x * z));
  const pitch = 2 * Math.atan2(sinp, cosp) - Math.PI / 2;

  // Yaw (z-axis rotation)
  const siny_cosp = 2 * (w * z + x * y);
  const cosy_cosp = 1 - 2 * (y * y + z * z);
  const yaw = Math.atan2(siny_cosp, cosy_cosp);

  return [radiansToDegrees(roll), radiansToDegrees(pitch), radiansToDegrees(yaw)];
}
