"use client"
import React, { useState } from "react"
import { recentOrders, Order } from "@/lib/mock-data"

export function RecentOrders() {
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const limit = 5

  const filtered = recentOrders.filter(o => 
    o.customer.toLowerCase().includes(search.toLowerCase()) || 
    o.id.toLowerCase().includes(search.toLowerCase())
  )

  const totalPages = Math.ceil(filtered.length / limit)
  const currentData = filtered.slice((page - 1) * limit, page * limit)

  return (
    <div className="col-span-1 md:col-span-2 lg:col-span-3 xl:col-span-4 2xl:col-span-4 border border-border bg-card rounded-xl flex flex-col overflow-hidden">
      <div className="p-5 border-b border-border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-lg font-semibold">Recent Orders</h2>
        <input 
          type="text" 
          placeholder="Search orders..." 
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="px-3 py-1.5 text-sm bg-muted border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted/50 text-xs text-muted-foreground uppercase">
            <tr>
              <th className="px-5 py-3 font-medium">Order</th>
              <th className="px-5 py-3 font-medium">Customer</th>
              <th className="px-5 py-3 font-medium">Product</th>
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-5 py-3 font-medium text-right">Amount</th>
              <th className="px-5 py-3 font-medium text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {currentData.length > 0 ? currentData.map((order) => (
              <tr key={order.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-5 py-3 font-medium">{order.id}</td>
                <td className="px-5 py-3">
                  <div>{order.customer}</div>
                  <div className="text-xs text-muted-foreground">{order.email}</div>
                </td>
                <td className="px-5 py-3 text-muted-foreground">{order.product}</td>
                <td className="px-5 py-3 text-muted-foreground whitespace-nowrap">{order.date}</td>
                <td className="px-5 py-3 text-right font-medium">${order.amount.toLocaleString()}</td>
                <td className="px-5 py-3 text-right">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize
                    ${order.status === 'completed' ? 'bg-green-500/10 text-green-500' :
                      order.status === 'processing' ? 'bg-blue-500/10 text-blue-500' :
                      order.status === 'cancelled' ? 'bg-red-500/10 text-red-500' :
                      'bg-yellow-500/10 text-yellow-500'}`}>
                    {order.status}
                  </span>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">No orders found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="p-4 border-t border-border flex items-center justify-between text-sm">
        <div className="text-muted-foreground">
          Showing {(page - 1) * limit + 1} to {Math.min(page * limit, filtered.length)} of {filtered.length} entries
        </div>
        <div className="flex gap-2">
          <button 
            disabled={page === 1} 
            onClick={() => setPage(p => p - 1)}
            className="px-3 py-1 border border-border rounded-md hover:bg-muted disabled:opacity-50"
          >
            Prev
          </button>
          <button 
            disabled={page === totalPages || totalPages === 0} 
            onClick={() => setPage(p => p + 1)}
            className="px-3 py-1 border border-border rounded-md hover:bg-muted disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
