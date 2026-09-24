"use client"

import React from "react"
import { useQuery } from "@tanstack/react-query"
import { fetchOrders } from "@/lib/dashboard-data"

export default function OrdersWidget() {
  const { data = [] } = useQuery<{ id: number; product: string; total: number; status: string }[]>({ queryKey: ["orders"], queryFn: fetchOrders })

  return (
    <div>
      <div className="text-sm text-muted-foreground mb-2">Recent Orders</div>
      <div className="overflow-auto max-h-64">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="text-left py-1">Order</th>
              <th className="text-left py-1">Product</th>
              <th className="text-left py-1">Total</th>
              <th className="text-left py-1">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.map((o: any) => (
              <tr key={o.id} className="border-t border-border">
                <td className="py-2">#{o.id}</td>
                <td className="py-2">{o.product}</td>
                <td className="py-2">₹{o.total}</td>
                <td className="py-2">{o.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
