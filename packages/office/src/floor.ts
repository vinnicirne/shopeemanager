export interface Point { x: number; y: number }

export const width = 400
export const height = 252
export const desks: Point[] = [
  { x: 90, y: 90 }, { x: 40, y: 150 }, { x: 200, y: 90 }, { x: 145, y: 150 },
  { x: 310, y: 90 }, { x: 255, y: 150 }, { x: 360, y: 150 },
]
export const lounge = desks.map(({ x }, index) => ({ x, y: index % 2 === 0 ? 222 : 227 }))

function brush(ctx: CanvasRenderingContext2D) {
  return (color: string, x: number, y: number, width: number, height: number) => {
    ctx.fillStyle = color
    ctx.fillRect(x, y, width, height)
  }
}

export function drawFloor(ctx: CanvasRenderingContext2D) {
  const rect = brush(ctx)
  rect('#282339', 0, 0, width, height)
  rect('#1c192c', 10, 16, 380, 229)
  rect('#51445d', 12, 11, 376, 228)
  rect('#ae8795', 16, 14, 368, 222)
  rect('#70566b', 16, 17, 368, 34)
  rect('#d09f97', 16, 46, 368, 4)
  for (const x of [63, 173, 283]) {
    rect('#493c54', x, 20, 54, 22)
    rect('#a5cbd2', x + 3, 23, 48, 15)
    rect('#7aa4b6', x + 3, 32, 48, 6)
    rect('#dde8d7', x + 8, 26, 8, 2)
    rect('#dde8d7', x + 35, 28, 12, 2)
    rect('#67526a', x + 25, 22, 3, 17)
    rect('#efc2a4', x - 2, 39, 58, 2)
  }
  const wood = ['#d2a27d', '#c59671', '#d8ac88', '#cea580']
  rect('#bf8d72', 16, 50, 368, 124)
  for (let row = 0; row < 15; row++) {
    const offset = row % 2 * 11
    for (let x = 16 - offset; x < 384; x += 22) {
      const left = Math.max(16, x)
      rect(wood[((x + row * 3) >> 1) % wood.length], left, 51 + row * 8, Math.min(x + 21, 384) - left, 7)
    }
  }
  rect('#9d696e', 16, 174, 368, 15)
  rect('#c78c89', 16, 177, 368, 9)
  rect('#e0a795', 16, 181, 368, 1)
  rect('#527b76', 16, 189, 368, 46)
  for (let x = 19; x < 383; x += 8) rect('#638b81', x, 191, 1, 42)
  rect('#365e63', 16, 233, 368, 2)
  for (const x of [67, 179, 291]) {
    rect('#354953', x - 12, 219, 32, 11)
    rect('#527d85', x - 12, 211, 32, 13)
    rect('#85a9a6', x - 10, 211, 28, 4)
    rect('#658f95', x - 8, 218, 12, 5)
    rect('#658f95', x + 5, 218, 11, 5)
    rect('#e3b58e', x + 27, 219, 6, 8)
  }
  for (const [x, y] of [[29, 64], [371, 65], [28, 204], [371, 204]]) {
    rect('#764d60', x - 4, y + 1, 9, 7)
    rect('#c4816a', x - 4, y, 9, 3)
    rect('#406358', x - 6, y - 6, 5, 7)
    rect('#72966d', x - 1, y - 11, 5, 12)
    rect('#4f8064', x + 4, y - 7, 4, 8)
  }
}

export function drawDesk(ctx: CanvasRenderingContext2D, { x, y }: Point, working: boolean) {
  const rect = brush(ctx)
  rect('#ab795f', x - 16, y - 8, 32, 7)
  rect('#71565e', x - 15, y - 14, 3, 12)
  rect('#71565e', x + 12, y - 14, 3, 12)
  rect('#8d5756', x - 16, y - 21, 32, 9)
  rect('#ebba8c', x - 16, y - 23, 32, 8)
  rect('#493d57', x + 1, y - 31, 13, 11)
  rect(working ? '#bfdf8d' : '#88a8ad', x + 3, y - 29, 9, 6)
  rect(working ? '#80a36a' : '#627b8c', x + 4, y - 27, 6, 1)
  rect('#55475d', x + 6, y - 21, 3, 3)
  rect('#f3e1ba', x - 14, y - 21, 6, 3)
  rect('#77606d', x - 2, y - 16, 11, 2)
}
