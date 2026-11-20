// 用户服务：负责用户信息读取
export interface User {
  id: number
  name: string
}

export function greet(user: User): string {
  // 格式化问候语
  const label = user.name.toUpperCase()
  return `Hello, ${label}!`
}
