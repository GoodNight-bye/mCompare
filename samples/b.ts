// User service: reads user info
export interface User {
  id: number
  name: string
}

export function greet(user: User): string {
  // 格式化问候语
  const label = user.name.toLowerCase()
  return `Hello, ${label}!`
}
