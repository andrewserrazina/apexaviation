// Wraps the .table-scroll/.admin-table pattern already hand-written in
// every admin table across the portal (MockOralDashboard, Billing,
// Payroll, etc.) so new/rebuilt pages share one wrapper instead of
// re-typing the two class names. Callers still own <thead>/<tbody> --
// row shapes differ too much page to page for a generic data-table API
// to earn its keep here.
export default function Table({ children, className = '' }) {
  return (
    <div className="table-scroll">
      <table className={`admin-table${className ? ` ${className}` : ''}`}>{children}</table>
    </div>
  )
}
