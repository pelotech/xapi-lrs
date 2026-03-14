/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    {
      name: "no-circular",
      comment: "No circular dependencies allowed.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-test-imports-in-production",
      comment: "Production code (src/) must not import from test/.",
      severity: "error",
      from: { path: "^src/" },
      to: { path: "^test/" },
    },
    {
      name: "admin-views-must-not-import-routes",
      comment: "Admin views are pure rendering — they must not import route handlers.",
      severity: "error",
      from: { path: "^src/admin/views/" },
      to: { path: "^src/routes/" },
    },
    {
      name: "repositories-must-not-import-routes",
      comment: "Repositories are data access — they must not import route handlers.",
      severity: "error",
      from: { path: "^src/repositories/" },
      to: { path: "^src/(routes|admin/index)" },
    },
    {
      name: "helpers-must-not-import-routes",
      comment: "Helpers are utilities — they must not import route handlers.",
      severity: "error",
      from: { path: "^src/helpers/" },
      to: { path: "^src/(routes|admin/index)" },
    },
    {
      name: "xapi-is-a-leaf",
      comment:
        "xapi/ (validation, multipart, signature) must not import from routes, repositories, or admin.",
      severity: "error",
      from: { path: "^src/xapi/" },
      to: { path: "^src/(routes|repositories|admin)/" },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};
