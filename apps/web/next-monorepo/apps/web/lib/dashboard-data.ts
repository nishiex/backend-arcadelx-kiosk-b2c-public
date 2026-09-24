"use client"

export async function fetchKPIs() {
  await new Promise((r) => setTimeout(r, 150))
  return {
    revenueLabel: "₹ 248,000",
    revenueChange: "+12.4%",
    orders: 1284,
    ordersChange: "+8.2%",
    customers: 8421,
    customersChange: "+18.1%",
    conversion: 4.82,
    conversionChange: "+0.8",
  }
}

export async function fetchRevenueSeries() {
  await new Promise((r) => setTimeout(r, 120))
  const now = new Date()
  const data = Array.from({ length: 14 }).map((_, i) => {
    const d = new Date(now.getTime() - (13 - i) * 24 * 60 * 60 * 1000)
    return { date: `${d.getMonth() + 1}/${d.getDate()}`, value: Math.round(20000 + Math.random() * 40000) }
  })
  return data
}

export async function fetchOrders() {
  await new Promise((r) => setTimeout(r, 100))
  return [
    { id: 10291, product: "Product A", total: 4200, status: "Paid" },
    { id: 10290, product: "Product B", total: 2800, status: "Pending" },
    { id: 10289, product: "Product C", total: 1500, status: "Shipped" },
  ]
}
