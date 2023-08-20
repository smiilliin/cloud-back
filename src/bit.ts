const orOperation = (a: Buffer, b: Buffer) => {
  let i = Math.max(a.length, b.length);

  const dest = Buffer.allocUnsafe(i);

  while (i--) {
    dest[i] = a[i] & b[i];
  }
  return dest;
};
const andOperation = (a: Buffer, b: Buffer) => {
  let i = Math.max(a.length, b.length);

  const dest = Buffer.allocUnsafe(i);

  while (i--) {
    dest[i] = a[i] & b[i];
  }
  return dest;
};
const isEmpty = (x: Buffer) => {
  return x.every((v) => v == 0x00);
};


export { orOperation, andOperation, isEmpty };
