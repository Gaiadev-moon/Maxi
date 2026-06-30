"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";

type Area = "drugstore" | "bar";

type Product = {
  id: string;
  name: string;
  category: string;
  area: Area;
  price: number;
  stock: number;
  min: number;
};

type LineItem = {
  productId: string;
  name: string;
  price: number;
  qty: number;
};

type Sale = {
  id: string;
  createdAt: string;
  area: Area;
  customer: string;
  payment: string;
  items: LineItem[];
  total: number;
};

type TableOrder = {
  id: string;
  name: string;
  items: LineItem[];
};

type AppState = {
  settings: {
    businessName: string;
    businessAddress: string;
    businessPhone: string;
    ticketFooter: string;
  };
  products: Product[];
  sales: Sale[];
  tables: TableOrder[];
};

type View = "dashboard" | "sales" | "stock" | "bar" | "reports" | "settings";

const storageKey = "maxi_drugstore_bar_v1";

const seedState: AppState = {
  settings: {
    businessName: "Drugstore y Bar",
    businessAddress: "Direccion del local",
    businessPhone: "",
    ticketFooter: "Gracias por su compra",
  },
  products: [
    { id: "p-coca", name: "Coca Cola 500ml", category: "Bebidas", area: "drugstore", price: 1500, stock: 24, min: 6 },
    { id: "p-agua", name: "Agua mineral", category: "Bebidas", area: "drugstore", price: 950, stock: 18, min: 6 },
    { id: "p-alfajor", name: "Alfajor triple", category: "Golosinas", area: "drugstore", price: 1200, stock: 30, min: 8 },
    { id: "p-cigarrillos", name: "Cigarrillos", category: "Kiosco", area: "drugstore", price: 2800, stock: 12, min: 4 },
    { id: "p-cafe", name: "Cafe", category: "Cafeteria", area: "bar", price: 1800, stock: 100, min: 10 },
    { id: "p-lomito", name: "Lomito completo", category: "Comida", area: "bar", price: 6800, stock: 50, min: 8 },
    { id: "p-pizza", name: "Pizza muzzarella", category: "Comida", area: "bar", price: 7400, stock: 40, min: 8 },
    { id: "p-cerveza", name: "Cerveza tirada", category: "Bebidas bar", area: "bar", price: 2600, stock: 80, min: 12 },
  ],
  sales: [],
  tables: [
    { id: "t-1", name: "Mesa 1", items: [] },
    { id: "t-2", name: "Mesa 2", items: [] },
    { id: "t-3", name: "Mesa 3", items: [] },
  ],
};

const viewCopy: Record<View, [string, string]> = {
  dashboard: ["Resumen", "Ventas, stock y mesas en un solo lugar."],
  sales: ["Ventas y tickets", "Cobro rapido para drugstore o bar con ticket local."],
  stock: ["Stock drugstore", "Alta, precio, minimo y reposicion de productos."],
  bar: ["Bar y mesas", "Menu, pedidos abiertos y cierre de mesa."],
  reports: ["Reportes", "Control de que se vende y por donde entra la plata."],
  settings: ["Ajustes", "Datos que aparecen en los tickets."],
};

const blankProduct: Product = {
  id: "",
  name: "",
  category: "",
  area: "drugstore",
  price: 0,
  stock: 0,
  min: 0,
};

export default function Home() {
  const [state, setState] = useState<AppState>(seedState);
  const [view, setView] = useState<View>("dashboard");
  const [cart, setCart] = useState<LineItem[]>([]);
  const [saleArea, setSaleArea] = useState<Area>("drugstore");
  const [saleSearch, setSaleSearch] = useState("");
  const [barSearch, setBarSearch] = useState("");
  const [customer, setCustomer] = useState("");
  const [payment, setPayment] = useState("Efectivo");
  const [selectedTableId, setSelectedTableId] = useState(seedState.tables[0]?.id ?? "");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as AppState;
        setState(parsed);
        setSelectedTableId(parsed.tables[0]?.id ?? "");
      } catch {
        setState(seedState);
      }
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  }, [state]);

  const todaySales = useMemo(() => state.sales.filter((sale) => isToday(sale.createdAt)), [state.sales]);
  const lowStock = state.products.filter((product) => product.stock <= product.min);
  const selectedTable = state.tables.find((table) => table.id === selectedTableId);
  const filteredSaleProducts = filterProducts(state.products, saleArea, saleSearch);
  const filteredMenu = filterProducts(state.products, "bar", barSearch);
  const cartSum = total(cart);
  const tableSum = total(selectedTable?.items ?? []);
  const [title, subtitle] = viewCopy[view];

  function mutate(next: AppState) {
    setState(next);
  }

  function addLine(productId: string, target: "cart" | "table") {
    const product = state.products.find((entry) => entry.id === productId);
    if (!product || product.stock <= 0) return;

    const apply = (items: LineItem[]) => {
      const current = items.find((item) => item.productId === productId);
      const currentQty = current?.qty ?? 0;
      if (currentQty >= product.stock) return items;
      if (current) {
        return items.map((item) => item.productId === productId ? { ...item, qty: item.qty + 1 } : item);
      }
      return [...items, { productId, name: product.name, price: product.price, qty: 1 }];
    };

    if (target === "cart") {
      setCart(apply);
      return;
    }

    mutate({
      ...state,
      tables: state.tables.map((table) => table.id === selectedTableId ? { ...table, items: apply(table.items) } : table),
    });
  }

  function changeQty(productId: string, delta: number, target: "cart" | "table") {
    const apply = (items: LineItem[]) => {
      const product = state.products.find((entry) => entry.id === productId);
      return items
        .map((item) => {
          if (item.productId !== productId) return item;
          const nextQty = Math.max(0, Math.min((product?.stock ?? item.qty) || item.qty, item.qty + delta));
          return { ...item, qty: nextQty };
        })
        .filter((item) => item.qty > 0);
    };

    if (target === "cart") {
      setCart(apply);
      return;
    }

    mutate({
      ...state,
      tables: state.tables.map((table) => table.id === selectedTableId ? { ...table, items: apply(table.items) } : table),
    });
  }

  function createSale(area: Area, saleCustomer: string, salePayment: string, items: LineItem[]) {
    const sale: Sale = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      area,
      customer: saleCustomer || "Consumidor final",
      payment: salePayment,
      items,
      total: total(items),
    };
    mutate({
      ...state,
      products: state.products.map((product) => {
        const item = items.find((entry) => entry.productId === product.id);
        return item ? { ...product, stock: Math.max(0, product.stock - item.qty) } : product;
      }),
      sales: [...state.sales, sale],
    });
    return sale;
  }

  function finishSale() {
    if (!cart.length) return;
    const sale = createSale(saleArea, customer, payment, cart);
    setCart([]);
    setCustomer("");
    setTimeout(() => printTicket(state.settings, sale), 50);
  }

  function closeTable() {
    if (!selectedTable?.items.length) return;
    const sale: Sale = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      area: "bar",
      customer: selectedTable.name,
      payment: "Mesa",
      items: selectedTable.items,
      total: tableSum,
    };
    mutate({
      ...state,
      products: state.products.map((product) => {
        const item = selectedTable.items.find((entry) => entry.productId === product.id);
        return item ? { ...product, stock: Math.max(0, product.stock - item.qty) } : product;
      }),
      sales: [...state.sales, sale],
      tables: state.tables.map((table) => table.id === selectedTable.id ? { ...table, items: [] } : table),
    });
    setTimeout(() => printTicket(state.settings, sale), 50);
  }

  function saveProduct(product: Product) {
    const normalized = { ...product, id: product.id || crypto.randomUUID(), price: Number(product.price), stock: Number(product.stock), min: Number(product.min) };
    const exists = state.products.some((entry) => entry.id === normalized.id);
    mutate({
      ...state,
      products: exists ? state.products.map((entry) => entry.id === normalized.id ? normalized : entry) : [...state.products, normalized],
    });
    setEditingProduct(null);
  }

  function deleteProduct(productId: string) {
    const isInTable = state.tables.some((table) => table.items.some((item) => item.productId === productId));
    if (isInTable) {
      window.alert("Ese producto esta en una mesa abierta.");
      return;
    }
    mutate({ ...state, products: state.products.filter((product) => product.id !== productId) });
    setCart((items) => items.filter((item) => item.productId !== productId));
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `backup-maxi-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function importData(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(String(reader.result)) as AppState;
        if (!imported.products || !imported.sales || !imported.tables) throw new Error("invalid");
        mutate(imported);
        setSelectedTableId(imported.tables[0]?.id ?? "");
      } catch {
        window.alert("No se pudo importar el archivo.");
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.brandMark}>MX</div>
          <div>
            <strong>Maxi</strong>
            <span>Drugstore + Bar</span>
          </div>
        </div>
        <nav className={styles.nav}>
          {Object.entries(viewCopy).map(([key, copy]) => (
            <button key={key} className={`${styles.navItem} ${view === key ? styles.active : ""}`} onClick={() => setView(key as View)}>
              {copy[0]}
            </button>
          ))}
        </nav>
      </aside>

      <main className={styles.main}>
        <header className={styles.topbar}>
          <div>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          <div className={styles.topActions}>
            <button className={styles.iconButton} onClick={exportData} title="Exportar datos">EX</button>
            <label className={styles.iconButton} title="Importar datos">
              IM
              <input type="file" accept="application/json" onChange={(event) => importData(event.target.files?.[0])} hidden />
            </label>
          </div>
        </header>

        {view === "dashboard" && (
          <>
            <div className={styles.metricGrid}>
              <Metric label="Ventas hoy" value={money(todaySales.reduce((sum, sale) => sum + sale.total, 0))} />
              <Metric label="Tickets hoy" value={String(todaySales.length)} />
              <Metric label="Mesas abiertas" value={String(state.tables.filter((table) => table.items.length).length)} />
              <Metric label="Stock bajo" value={String(lowStock.length)} alert />
            </div>
            <div className={styles.twoColumn}>
              <Panel title="Ultimas ventas">
                <ListEmpty show={!state.sales.length} text="Todavia no hay ventas." />
                {state.sales.slice(-5).reverse().map((sale) => <ListItem key={sale.id} title={`${sale.customer} - ${money(sale.total)}`} meta={`${date(sale.createdAt)} · ${labelArea(sale.area)} · ${sale.payment}`} />)}
              </Panel>
              <Panel title="Reposicion sugerida">
                <ListEmpty show={!lowStock.length} text="No hay productos en stock bajo." />
                {lowStock.map((product) => <ListItem key={product.id} title={product.name} meta={`Quedan ${product.stock}. Minimo sugerido: ${product.min}`} />)}
              </Panel>
            </div>
          </>
        )}

        {view === "sales" && (
          <div className={styles.workGrid}>
            <Panel title="Nueva venta" action={<select value={saleArea} onChange={(event) => setSaleArea(event.target.value as Area)}><option value="drugstore">Drugstore</option><option value="bar">Bar</option></select>}>
              <input type="search" placeholder="Buscar producto o item..." value={saleSearch} onChange={(event) => setSaleSearch(event.target.value)} />
              <ProductGrid products={filteredSaleProducts} onPick={(id) => addLine(id, "cart")} />
            </Panel>
            <Panel title="Ticket" action={<button className={styles.smallButton} onClick={() => setCart([])}>Vaciar</button>} sticky>
              <Cart items={cart} onQty={(id, delta) => changeQty(id, delta, "cart")} />
              <div className={styles.checkoutFooter}>
                <label>Cliente<input value={customer} onChange={(event) => setCustomer(event.target.value)} placeholder="Consumidor final" /></label>
                <label>Pago<select value={payment} onChange={(event) => setPayment(event.target.value)}><option>Efectivo</option><option>Transferencia</option><option>Tarjeta</option><option>Cuenta corriente</option></select></label>
                <Total label="Total" value={cartSum} />
                <button className={styles.primaryButton} onClick={finishSale}>Cobrar e imprimir</button>
              </div>
            </Panel>
          </div>
        )}

        {view === "stock" && (
          <Panel title="Productos" action={<button className={styles.primaryCompact} onClick={() => setEditingProduct(blankProduct)}>Agregar producto</button>}>
            <div className={styles.tableWrap}>
              <table>
                <thead><tr><th>Producto</th><th>Categoria</th><th>Precio</th><th>Stock</th><th>Min.</th><th /></tr></thead>
                <tbody>
                  {state.products.map((product) => (
                    <tr key={product.id}>
                      <td><strong>{product.name}</strong><br /><span>{labelArea(product.area)}</span></td>
                      <td>{product.category}</td>
                      <td>{money(product.price)}</td>
                      <td className={product.stock <= product.min ? styles.low : ""}>{product.stock}</td>
                      <td>{product.min}</td>
                      <td><div className={styles.rowActions}><button className={styles.smallButton} onClick={() => setEditingProduct(product)}>Editar</button><button className={styles.smallButton} onClick={() => deleteProduct(product.id)}>Borrar</button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        {view === "bar" && (
          <div className={styles.workGrid}>
            <Panel title="Mesas" action={<button className={styles.primaryCompact} onClick={() => {
              const table = { id: crypto.randomUUID(), name: `Mesa ${state.tables.length + 1}`, items: [] };
              mutate({ ...state, tables: [...state.tables, table] });
              setSelectedTableId(table.id);
            }}>Nueva mesa</button>}>
              <div className={styles.tableGrid}>
                {state.tables.map((table) => (
                  <button key={table.id} className={`${styles.tableCard} ${selectedTableId === table.id ? styles.selected : ""}`} onClick={() => setSelectedTableId(table.id)}>
                    <strong>{table.name}</strong>
                    <span>{table.items.length} items</span>
                    <span>{money(total(table.items))}</span>
                  </button>
                ))}
              </div>
            </Panel>
            <Panel title={`Pedido - ${selectedTable?.name ?? "mesa"}`} action={<button className={styles.smallButton} onClick={closeTable}>Cerrar mesa</button>} sticky>
              <input type="search" placeholder="Buscar en menu..." value={barSearch} onChange={(event) => setBarSearch(event.target.value)} />
              <ProductGrid products={filteredMenu} onPick={(id) => addLine(id, "table")} compact />
              <Cart items={selectedTable?.items ?? []} onQty={(id, delta) => changeQty(id, delta, "table")} />
              <div className={styles.checkoutFooter}><Total label="Total mesa" value={tableSum} /></div>
            </Panel>
          </div>
        )}

        {view === "reports" && (
          <>
            <div className={styles.twoColumn}>
              <Panel title="Ventas por area"><AreaReport sales={state.sales} /></Panel>
              <Panel title="Mas vendidos"><TopItems sales={state.sales} /></Panel>
            </div>
            <Panel title="Historial">
              <div className={styles.tableWrap}>
                <table>
                  <thead><tr><th>Fecha</th><th>Area</th><th>Cliente</th><th>Pago</th><th>Total</th><th /></tr></thead>
                  <tbody>
                    {state.sales.slice().reverse().map((sale) => (
                      <tr key={sale.id}><td>{date(sale.createdAt)}</td><td>{labelArea(sale.area)}</td><td>{sale.customer}</td><td>{sale.payment}</td><td>{money(sale.total)}</td><td><button className={styles.smallButton} onClick={() => printTicket(state.settings, sale)}>Ticket</button></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </>
        )}

        {view === "settings" && (
          <Panel title="Datos del local" narrow>
            <SettingsForm state={state} onSave={(settings) => mutate({ ...state, settings })} />
          </Panel>
        )}
      </main>

      {editingProduct && <ProductModal product={editingProduct} onCancel={() => setEditingProduct(null)} onSave={saveProduct} />}
    </div>
  );
}

function Metric({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return <article className={`${styles.metric} ${alert ? styles.metricAlert : ""}`}><span>{label}</span><strong>{value}</strong></article>;
}

function Panel({ title, action, children, sticky, narrow }: { title: string; action?: React.ReactNode; children: React.ReactNode; sticky?: boolean; narrow?: boolean }) {
  return <section className={`${styles.panel} ${sticky ? styles.sticky : ""} ${narrow ? styles.narrow : ""}`}><div className={styles.panelHeader}><h2>{title}</h2>{action}</div>{children}</section>;
}

function ProductGrid({ products, onPick, compact }: { products: Product[]; onPick: (id: string) => void; compact?: boolean }) {
  if (!products.length) return <div className={styles.empty}>Sin resultados.</div>;
  return <div className={`${styles.productGrid} ${compact ? styles.compactGrid : ""}`}>{products.map((product) => <button key={product.id} className={`${styles.productCard} ${product.stock <= 0 ? styles.out : ""}`} disabled={product.stock <= 0} onClick={() => onPick(product.id)}><strong>{product.name}</strong><span>{product.category} · {money(product.price)}</span><span>Stock: {product.stock}</span></button>)}</div>;
}

function Cart({ items, onQty }: { items: LineItem[]; onQty: (id: string, delta: number) => void }) {
  if (!items.length) return <div className={styles.empty}>El pedido esta vacio.</div>;
  return <div className={styles.cartList}>{items.map((item) => <div className={styles.cartItem} key={item.productId}><div><strong>{item.name}</strong><span>{item.qty} x {money(item.price)} = {money(item.qty * item.price)}</span></div><div className={styles.qtyControls}><button onClick={() => onQty(item.productId, -1)}>-</button><strong>{item.qty}</strong><button onClick={() => onQty(item.productId, 1)}>+</button></div></div>)}</div>;
}

function Total({ label, value }: { label: string; value: number }) {
  return <div className={styles.totalRow}><span>{label}</span><strong>{money(value)}</strong></div>;
}

function ListItem({ title, meta }: { title: string; meta: string }) {
  return <div className={styles.listItem}><strong>{title}</strong><span>{meta}</span></div>;
}

function ListEmpty({ show, text }: { show: boolean; text: string }) {
  return show ? <div className={styles.empty}>{text}</div> : null;
}

function SettingsForm({ state, onSave }: { state: AppState; onSave: (settings: AppState["settings"]) => void }) {
  const [settings, setSettings] = useState(state.settings);
  return <div className={styles.settingsForm}><label>Nombre del local<input value={settings.businessName} onChange={(event) => setSettings({ ...settings, businessName: event.target.value })} /></label><label>Direccion<input value={settings.businessAddress} onChange={(event) => setSettings({ ...settings, businessAddress: event.target.value })} /></label><label>Telefono<input value={settings.businessPhone} onChange={(event) => setSettings({ ...settings, businessPhone: event.target.value })} /></label><label>Texto al pie del ticket<input value={settings.ticketFooter} onChange={(event) => setSettings({ ...settings, ticketFooter: event.target.value })} /></label><button className={styles.primaryCompact} onClick={() => onSave(settings)}>Guardar ajustes</button></div>;
}

function ProductModal({ product, onCancel, onSave }: { product: Product; onCancel: () => void; onSave: (product: Product) => void }) {
  const [draft, setDraft] = useState(product);
  return <div className={styles.modalBackdrop}><form className={styles.modal} onSubmit={(event) => { event.preventDefault(); onSave(draft); }}><h2>{draft.id ? "Editar producto" : "Agregar producto"}</h2><label>Nombre<input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label>Categoria<input required value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} /></label><label>Area<select value={draft.area} onChange={(event) => setDraft({ ...draft, area: event.target.value as Area })}><option value="drugstore">Drugstore</option><option value="bar">Bar</option></select></label><div className={styles.formGrid}><label>Precio<input type="number" min="0" value={draft.price} onChange={(event) => setDraft({ ...draft, price: Number(event.target.value) })} /></label><label>Stock<input type="number" min="0" value={draft.stock} onChange={(event) => setDraft({ ...draft, stock: Number(event.target.value) })} /></label><label>Minimo<input type="number" min="0" value={draft.min} onChange={(event) => setDraft({ ...draft, min: Number(event.target.value) })} /></label></div><div className={styles.modalActions}><button type="button" className={styles.smallButton} onClick={onCancel}>Cancelar</button><button className={styles.primaryCompact}>Guardar</button></div></form></div>;
}

function AreaReport({ sales }: { sales: Sale[] }) {
  const totals = sales.reduce<Record<Area, number>>((acc, sale) => ({ ...acc, [sale.area]: acc[sale.area] + sale.total }), { drugstore: 0, bar: 0 });
  const max = Math.max(1, totals.drugstore, totals.bar);
  return <div className={styles.reportBars}>{(["drugstore", "bar"] as Area[]).map((area) => <div className={styles.barLine} key={area}><header><strong>{labelArea(area)}</strong><span>{money(totals[area])}</span></header><div className={styles.barTrack}><div className={styles.barFill} style={{ width: `${(totals[area] / max) * 100}%` }} /></div></div>)}</div>;
}

function TopItems({ sales }: { sales: Sale[] }) {
  const items = new Map<string, number>();
  sales.forEach((sale) => sale.items.forEach((item) => items.set(item.name, (items.get(item.name) ?? 0) + item.qty)));
  const sorted = [...items.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (!sorted.length) return <div className={styles.empty}>Sin ventas registradas.</div>;
  return <>{sorted.map(([name, qty]) => <ListItem key={name} title={name} meta={`${qty} vendidos`} />)}</>;
}

function filterProducts(products: Product[], area: Area, query: string) {
  const normalized = normalize(query);
  return products.filter((product) => product.area === area && normalize(`${product.name} ${product.category}`).includes(normalized));
}

function total(items: LineItem[]) {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

function money(value: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(value || 0);
}

function date(value: string) {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function isToday(value: string) {
  const dateValue = new Date(value);
  const now = new Date();
  return dateValue.getFullYear() === now.getFullYear() && dateValue.getMonth() === now.getMonth() && dateValue.getDate() === now.getDate();
}

function labelArea(area: Area) {
  return area === "bar" ? "Bar" : "Drugstore";
}

function normalize(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function printTicket(settings: AppState["settings"], sale: Sale) {
  const old = document.getElementById("printTicket");
  old?.remove();
  const ticket = document.createElement("section");
  ticket.id = "printTicket";
  ticket.innerHTML = `<h2>${settings.businessName}</h2><p>${settings.businessAddress}</p><p>${settings.businessPhone}</p><hr><p>Ticket: ${sale.id.slice(-6).toUpperCase()}</p><p>Fecha: ${date(sale.createdAt)}</p><p>Area: ${labelArea(sale.area)}</p><p>Cliente: ${sale.customer}</p><hr>${sale.items.map((item) => `<p>${item.name}<br>${item.qty} x ${money(item.price)} = ${money(item.qty * item.price)}</p>`).join("")}<hr><h3>Total: ${money(sale.total)}</h3><p>Pago: ${sale.payment}</p><p>${settings.ticketFooter}</p>`;
  document.body.appendChild(ticket);
  window.print();
}
