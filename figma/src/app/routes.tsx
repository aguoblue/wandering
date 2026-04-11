import React from "react";
import { createBrowserRouter } from "react-router";
import { PlansListPage } from "./pages/PlansListPage";
import { PlanDetailPage } from "./pages/PlanDetailPage";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: PlansListPage,
  },
  {
    path: "/plan/:id",
    Component: PlanDetailPage,
  },
  {
    path: "*",
    Component: () => (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-bold mb-4">404</h1>
          <p className="text-muted-foreground mb-4">
            页面未找到
          </p>
          <a href="/" className="text-blue-600 hover:underline">
            返回首页
          </a>
        </div>
      </div>
    ),
  },
]);