"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
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
  ticketNumber: string;
  createdAt: string;
  area: Area;
  customer: string;
  payment: string;
  items: LineItem[];
  total: number;
};

type TableStatus = "vacio" | "preparacion" | "entregado";

type TableOrder = {
  id: string;
  name: string;
  status: TableStatus;
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

type View = "dashboard" | "drugstore" | "bar" | "reports" | "settings";
type DrugstoreOption = "venta" | "stock";
type BarOption = "mesas" | "menu" | "venta";

const storageKey = "maxi_drugstore_bar_v1";

const seedState: AppState = {
  settings: {
    businessName: "Al toque",
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
    { id: "t-1", name: "Mesa 1", status: "vacio", items: [] },
    { id: "t-2", name: "Mesa 2", status: "vacio", items: [] },
    { id: "t-3", name: "Mesa 3", status: "vacio", items: [] },
  ],
};

const viewCopy: Record<View, [string, string]> = {
  dashboard: ["Resumen", "Ventas, stock y mesas en un solo lugar."],
  drugstore: ["Drugstore", "Ventas, tickets y stock del drugstore."],
  bar: ["Bar", "Menu, mesas, estados de pedido y ventas del bar."],
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
  const [drugstoreOption, setDrugstoreOption] = useState<DrugstoreOption>("venta");
  const [barOption, setBarOption] = useState<BarOption>("mesas");
  const [drugstoreCart, setDrugstoreCart] = useState<LineItem[]>([]);
  const [barCart, setBarCart] = useState<LineItem[]>([]);
  const [saleSearch, setSaleSearch] = useState("");
  const [barSearch, setBarSearch] = useState("");
  const [drugstoreCustomer, setDrugstoreCustomer] = useState("");
  const [barCustomer, setBarCustomer] = useState("");
  const [drugstorePayment, setDrugstorePayment] = useState("Efectivo");
  const [barPayment, setBarPayment] = useState("Efectivo");
  const [reportDate, setReportDate] = useState(() => dateKey(new Date()));
  const [selectedTableId, setSelectedTableId] = useState(seedState.tables[0]?.id ?? "");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [stockProduct, setStockProduct] = useState<Product | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    if (saved) {
      try {
        const parsed = normalizeState(JSON.parse(saved) as AppState);
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
  const drugstoreSales = state.sales.filter((sale) => sale.area === "drugstore");
  const barSales = state.sales.filter((sale) => sale.area === "bar");
  const selectedDaySales = state.sales.filter((sale) => dateKey(new Date(sale.createdAt)) === reportDate);
  const selectedDayDrugstoreSales = selectedDaySales.filter((sale) => sale.area === "drugstore");
  const selectedDayBarSales = selectedDaySales.filter((sale) => sale.area === "bar");
  const todayDrugstoreSales = todaySales.filter((sale) => sale.area === "drugstore");
  const openTables = state.tables.filter((table) => table.items.length);
  const lowDrugstoreStock = state.products.filter((product) => product.area === "drugstore" && product.stock <= product.min);
  const selectedTable = state.tables.find((table) => table.id === selectedTableId);
  const filteredDrugstoreSaleProducts = filterProducts(state.products, "drugstore", saleSearch);
  const filteredBarSaleProducts = filterProducts(state.products, "bar", saleSearch);
  const filteredMenu = filterProducts(state.products, "bar", barSearch);
  const drugstoreProducts = state.products.filter((product) => product.area === "drugstore");
  const barProducts = state.products.filter((product) => product.area === "bar");
  const drugstoreCartSum = total(drugstoreCart);
  const barCartSum = total(barCart);
  const tableSum = total(selectedTable?.items ?? []);
  const [title, subtitle] = viewCopy[view];

  function mutate(next: AppState) {
    setState(next);
  }

  function addLine(productId: string, target: "drugstoreCart" | "barCart" | "table") {
    const product = state.products.find((entry) => entry.id === productId);
    if (!product || (product.area === "drugstore" && product.stock <= 0)) return;

    const apply = (items: LineItem[]) => {
      const current = items.find((item) => item.productId === productId);
      const currentQty = current?.qty ?? 0;
      if (product.area === "drugstore" && currentQty >= product.stock) return items;
      if (current) {
        return items.map((item) => item.productId === productId ? { ...item, qty: item.qty + 1 } : item);
      }
      return [...items, { productId, name: product.name, price: product.price, qty: 1 }];
    };

    if (target === "drugstoreCart") {
      setDrugstoreCart(apply);
      return;
    }

    if (target === "barCart") {
      setBarCart(apply);
      return;
    }

    mutate({
      ...state,
      tables: state.tables.map((table) => table.id === selectedTableId ? { ...table, status: "preparacion", items: apply(table.items) } : table),
    });
  }

  function changeQty(productId: string, delta: number, target: "drugstoreCart" | "barCart" | "table") {
    const apply = (items: LineItem[]) => {
      const product = state.products.find((entry) => entry.id === productId);
      return items
        .map((item) => {
          if (item.productId !== productId) return item;
          const limit = product?.area === "drugstore" ? product.stock : Number.MAX_SAFE_INTEGER;
          const nextQty = Math.max(0, Math.min(limit, item.qty + delta));
          return { ...item, qty: nextQty };
        })
        .filter((item) => item.qty > 0);
    };

    if (target === "drugstoreCart") {
      setDrugstoreCart(apply);
      return;
    }

    if (target === "barCart") {
      setBarCart(apply);
      return;
    }

    mutate({
      ...state,
      tables: state.tables.map((table) => {
        if (table.id !== selectedTableId) return table;
        const items = apply(table.items);
        return { ...table, status: items.length ? table.status : "vacio", items };
      }),
    });
  }

  function createSale(area: Area, saleCustomer: string, salePayment: string, items: LineItem[]) {
    const sale: Sale = {
      id: crypto.randomUUID(),
      ticketNumber: nextTicketNumber(state.sales, area),
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
        return item && product.area === "drugstore" ? { ...product, stock: Math.max(0, product.stock - item.qty) } : product;
      }),
      sales: [...state.sales, sale],
    });
    return sale;
  }

  function finishSale(area: Area) {
    const cart = area === "drugstore" ? drugstoreCart : barCart;
    if (!cart.length) return;
    const sale = createSale(
      area,
      area === "drugstore" ? drugstoreCustomer : barCustomer,
      area === "drugstore" ? drugstorePayment : barPayment,
      cart,
    );
    if (area === "drugstore") {
      setDrugstoreCart([]);
      setDrugstoreCustomer("");
    } else {
      setBarCart([]);
      setBarCustomer("");
    }
    setTimeout(() => printTicket(state.settings, sale), 50);
  }

  function closeTable() {
    if (!selectedTable?.items.length) return;
    const sale: Sale = {
      id: crypto.randomUUID(),
      ticketNumber: nextTicketNumber(state.sales, "bar"),
      createdAt: new Date().toISOString(),
      area: "bar",
      customer: selectedTable.name,
      payment: "Mesa",
      items: selectedTable.items,
      total: tableSum,
    };
    mutate({
      ...state,
      products: state.products,
      sales: [...state.sales, sale],
      tables: state.tables.map((table) => table.id === selectedTable.id ? { ...table, status: "vacio", items: [] } : table),
    });
    setTimeout(() => printTicket(state.settings, sale), 50);
  }

  function setTableStatus(tableId: string, status: TableStatus) {
    mutate({
      ...state,
      tables: state.tables.map((table) => table.id === tableId ? { ...table, status } : table),
    });
  }

  function deleteTable(tableId: string) {
    const table = state.tables.find((entry) => entry.id === tableId);
    if (!table) return;
    if (table.items.length && !window.confirm(`La ${table.name} tiene un pedido. Queres eliminarla igualmente?`)) return;
    const remaining = state.tables.filter((entry) => entry.id !== tableId);
    mutate({ ...state, tables: remaining });
    setSelectedTableId(remaining[0]?.id ?? "");
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
    const product = state.products.find((entry) => entry.id === productId);
    if (!product) return;
    const isInTable = state.tables.some((table) => table.items.some((item) => item.productId === productId));
    if (isInTable) {
      window.alert("Ese producto esta en una mesa abierta.");
      return;
    }
    if (!window.confirm(`Queres borrar ${product.name}? Esta accion no se puede deshacer.`)) return;
    mutate({ ...state, products: state.products.filter((product) => product.id !== productId) });
    setDrugstoreCart((items) => items.filter((item) => item.productId !== productId));
    setBarCart((items) => items.filter((item) => item.productId !== productId));
  }

  function addStock(productId: string, quantity: number) {
    if (quantity <= 0) return;
    mutate({
      ...state,
      products: state.products.map((product) => product.id === productId ? { ...product, stock: product.stock + quantity } : product),
    });
    setStockProduct(null);
  }

  return (
    <div className={styles.shell}>
      <main className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.headerBrand}>
            <button className={styles.logoButton} onClick={() => setView("dashboard")} aria-label="Volver al inicio">
              <Image className={styles.brandLogo} src="/al-toque-logo.png" alt="Al toque" width={72} height={72} priority />
            </button>
            <div>
              <span>Bar · Cafeteria</span>
              <h1>{view === "dashboard" ? "Al toque" : title}</h1>
              <p>{view === "dashboard" ? "Elegí con qué módulo trabajar." : subtitle}</p>
            </div>
          </div>
          <div className={styles.topActions}>
            {view !== "dashboard" && <button className={styles.textButton} onClick={() => setView("dashboard")}>Inicio</button>}
            <button className={styles.textButton} onClick={() => setView("reports")}>Reportes</button>
            <button className={styles.textButton} onClick={() => setView("settings")}>Ajustes</button>
          </div>
        </header>

        {view === "dashboard" && (
          <>
            <div className={styles.moduleChoiceGrid}>
              <button className={`${styles.moduleChoice} ${styles.drugstoreChoice}`} onClick={() => setView("drugstore")}>
                <span>Entrar a</span>
                <strong>Drugstore</strong>
                <small>{money(todayDrugstoreSales.reduce((sum, sale) => sum + sale.total, 0))} vendidos hoy</small>
              </button>
              <button className={`${styles.moduleChoice} ${styles.barChoice}`} onClick={() => setView("bar")}>
                <span>Entrar a</span>
                <strong>Bar</strong>
                <small>{openTables.length} mesas con pedido</small>
              </button>
            </div>
          </>
        )}

        {view === "drugstore" && (
          <section className={styles.drugstoreSection}>
            <div className={styles.drugstoreNav}>
              <SegmentedControl
                tone="drugstore"
                options={[
                  ["venta", "Venta y tickets"],
                  ["stock", lowDrugstoreStock.length > 0 ? `Control de stock - ${lowDrugstoreStock.length} alertas` : "Control de stock"],
                ]}
                value={drugstoreOption}
                onChange={(value) => setDrugstoreOption(value as DrugstoreOption)}
              />
            </div>
            <div className={styles.drugstoreContent}>
              {drugstoreOption === "venta" && (
                <div className={styles.drugstoreSaleLayout}>
                  <Panel title="Productos" variant="catalog">
                    <input type="search" placeholder="Buscar producto..." value={saleSearch} onChange={(event) => setSaleSearch(event.target.value)} />
                    <ProductGrid products={filteredDrugstoreSaleProducts} onPick={(id) => addLine(id, "drugstoreCart")} showStock hideCategory />
                  </Panel>
                  <SaleTicket cart={drugstoreCart} customer={drugstoreCustomer} payment={drugstorePayment} cartSum={drugstoreCartSum} setCart={setDrugstoreCart} setCustomer={setDrugstoreCustomer} setPayment={setDrugstorePayment} onQty={(id, delta) => changeQty(id, delta, "drugstoreCart")} onFinish={() => finishSale("drugstore")} />
                </div>
              )}
              {drugstoreOption === "stock" && (
                <div className={styles.inventoryLayout}>
                  <ProductTable
                    title="Inventario"
                    products={drugstoreProducts}
                    onAdd={() => setEditingProduct({ ...blankProduct, area: "drugstore" })}
                    onEdit={setEditingProduct}
                    onDelete={deleteProduct}
                    onAddStock={setStockProduct}
                    variant="inventory"
                    hideCategory
                  />
                  {lowDrugstoreStock.length > 0 && (
                    <Panel title="Necesitan reposicion" variant="alert">
                      {lowDrugstoreStock.map((product) => <ListItem key={product.id} title={product.name} meta={`Quedan ${product.stock}. Minimo sugerido: ${product.min}`} />)}
                    </Panel>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {view === "bar" && (
          <section className={styles.barSection}>
            <div className={styles.barNav}>
              <SegmentedControl
                tone="bar"
                options={[
                  ["mesas", "Mesas y pedidos"],
                  ["menu", "Menu"],
                  ["venta", "Venta barra"],
                ]}
                value={barOption}
                onChange={(value) => setBarOption(value as BarOption)}
              />
            </div>
            <div className={styles.barContent}>
            {barOption === "mesas" && (
              <div className={styles.tablesWorkspace}>
                <Panel title="Mesas" action={<button className={styles.primaryCompact} onClick={() => {
                  const table = { id: crypto.randomUUID(), name: nextTableName(state.tables), status: "vacio" as TableStatus, items: [] };
                  mutate({ ...state, tables: [...state.tables, table] });
                  setSelectedTableId(table.id);
                }}>Nueva mesa</button>}>
                  <div className={styles.tableGrid}>
                    {state.tables.map((table) => (
                      <button key={table.id} className={`${styles.tableCard} ${selectedTableId === table.id ? styles.selected : ""}`} onClick={() => setSelectedTableId(table.id)}>
                        <strong>{table.name}</strong>
                        <span className={`${styles.statusPill} ${statusClass(table.status)}`}>{statusLabel(table.status)}</span>
                        <span>{table.items.length} items</span>
                        <span>{money(total(table.items))}</span>
                      </button>
                    ))}
                  </div>
                </Panel>
                <div className={styles.tableOrderColumn}>
                  <Panel title={`Agregar al pedido - ${selectedTable?.name ?? "mesa"}`}>
                    <input type="search" placeholder="Buscar en menu..." value={barSearch} onChange={(event) => setBarSearch(event.target.value)} />
                    <ProductGrid products={filteredMenu} onPick={(id) => addLine(id, "table")} compact hideCategory />
                  </Panel>
                  <Panel title={`Ticket - ${selectedTable?.name ?? "mesa"}`} action={<div className={styles.rowActions}><button className={styles.smallButton} onClick={() => selectedTable && deleteTable(selectedTable.id)}>Eliminar mesa</button><button className={styles.primaryCompact} onClick={closeTable}>Cobrar mesa</button></div>} sticky>
                    <div className={styles.statusActions}>
                      <button disabled={Boolean(selectedTable?.items.length)} className={selectedTable?.status === "vacio" ? styles.statusActive : ""} onClick={() => selectedTable && setTableStatus(selectedTable.id, "vacio")}>Vacio</button>
                      <button disabled={!selectedTable?.items.length} className={selectedTable?.status === "preparacion" ? styles.statusActive : ""} onClick={() => selectedTable && setTableStatus(selectedTable.id, "preparacion")}>En preparacion</button>
                      <button disabled={!selectedTable?.items.length} className={selectedTable?.status === "entregado" ? styles.statusActive : ""} onClick={() => selectedTable && setTableStatus(selectedTable.id, "entregado")}>Entregado</button>
                    </div>
                    <Cart items={selectedTable?.items ?? []} onQty={(id, delta) => changeQty(id, delta, "table")} />
                    <div className={styles.checkoutFooter}><Total label="Total mesa" value={tableSum} /></div>
                  </Panel>
                </div>
              </div>
            )}
            {barOption === "menu" && (
              <>
                <ProductTable
                  title="Menu del bar"
                  products={barProducts}
                  onAdd={() => setEditingProduct({ ...blankProduct, area: "bar" })}
                  onEdit={setEditingProduct}
                  onDelete={deleteProduct}
                  menuOnly
                  hideCategory
                />
              </>
            )}
            {barOption === "venta" && (
              <div className={styles.workGrid}>
                <Panel title="Venta barra">
                  <input type="search" placeholder="Buscar item del bar..." value={saleSearch} onChange={(event) => setSaleSearch(event.target.value)} />
                  <ProductGrid products={filteredBarSaleProducts} onPick={(id) => addLine(id, "barCart")} hideCategory />
                </Panel>
                <SaleTicket cart={barCart} customer={barCustomer} payment={barPayment} cartSum={barCartSum} setCart={setBarCart} setCustomer={setBarCustomer} setPayment={setBarPayment} onQty={(id, delta) => changeQty(id, delta, "barCart")} onFinish={() => finishSale("bar")} />
              </div>
            )}
            </div>
          </section>
        )}

        {view === "reports" && (
          <>
            <section className={styles.dailyReportSection}>
              <div className={styles.reportDateBar}>
                <div>
                  <span>Resumen diario</span>
                  <h2>Que se vendio</h2>
                </div>
                <label>Elegir fecha<input type="date" value={reportDate} max={dateKey(new Date())} onChange={(event) => setReportDate(event.target.value)} /></label>
              </div>
              <div className={styles.dailySalesGrid}>
                <Panel title="Drugstore"><DailyItems sales={selectedDayDrugstoreSales} /></Panel>
                <Panel title="Bar"><DailyItems sales={selectedDayBarSales} /></Panel>
              </div>
            </section>
            <div className={styles.twoColumn}>
              <Panel title="Ventas por area"><AreaReport sales={state.sales} /></Panel>
              <Panel title="Mas vendidos"><TopItems sales={state.sales} /></Panel>
            </div>
            <div className={styles.reportsBillingGrid}>
              <SalesTable title="Facturacion Drugstore" sales={drugstoreSales} settings={state.settings} />
              <SalesTable title="Facturacion Bar" sales={barSales} settings={state.settings} />
            </div>
          </>
        )}

        {view === "settings" && (
          <Panel title="Datos del local" narrow>
            <SettingsForm state={state} onSave={(settings) => mutate({ ...state, settings })} />
          </Panel>
        )}
      </main>

      {editingProduct && <ProductModal product={editingProduct} onCancel={() => setEditingProduct(null)} onSave={saveProduct} />}
      {stockProduct && <StockModal product={stockProduct} onCancel={() => setStockProduct(null)} onSave={(quantity) => addStock(stockProduct.id, quantity)} />}
    </div>
  );
}

function SegmentedControl({ options, value, onChange, tone }: { options: [string, string][]; value: string; onChange: (value: string) => void; tone?: "drugstore" | "bar" }) {
  return (
    <div className={`${styles.segmentedControl} ${tone === "bar" ? styles.barTabs : styles.drugstoreTabs}`}>
      {options.map(([key, label]) => (
        <button key={key} className={`${value === key ? styles.segmentActive : ""} ${key === "stock" ? styles.stockTab : ""}`} onClick={() => onChange(key)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function SaleTicket({
  cart,
  customer,
  payment,
  cartSum,
  setCart,
  setCustomer,
  setPayment,
  onQty,
  onFinish,
}: {
  cart: LineItem[];
  customer: string;
  payment: string;
  cartSum: number;
  setCart: (items: LineItem[]) => void;
  setCustomer: (value: string) => void;
  setPayment: (value: string) => void;
  onQty: (id: string, delta: number) => void;
  onFinish: () => void;
}) {
  return (
    <Panel title="Ticket actual" action={<button className={styles.smallButton} onClick={() => setCart([])}>Vaciar</button>} sticky variant="ticket">
      <Cart items={cart} onQty={onQty} />
      <div className={styles.checkoutFooter}>
        <label>Cliente<input value={customer} onChange={(event) => setCustomer(event.target.value)} placeholder="Consumidor final" /></label>
        <label>Pago<select value={payment} onChange={(event) => setPayment(event.target.value)}><option>Efectivo</option><option>Transferencia</option><option>Tarjeta</option><option>Cuenta corriente</option></select></label>
        <Total label="Total" value={cartSum} />
        <button className={styles.primaryButton} onClick={onFinish}>Cobrar e imprimir</button>
      </div>
    </Panel>
  );
}

function ProductTable({ title, products, onAdd, onEdit, onDelete, onAddStock, menuOnly = false, variant, hideCategory = false }: { title: string; products: Product[]; onAdd: () => void; onEdit: (product: Product) => void; onDelete: (productId: string) => void; onAddStock?: (product: Product) => void; menuOnly?: boolean; variant?: "inventory"; hideCategory?: boolean }) {
  return (
    <Panel title={title} action={<button className={styles.primaryCompact} onClick={onAdd}>Agregar producto</button>} variant={variant}>
      <div className={styles.tableWrap}>
        <table>
          <thead><tr><th>Producto</th>{!hideCategory && <th>Categoria</th>}<th>Precio</th>{!menuOnly && <th>Stock</th>}{!menuOnly && <th>Min.</th>}<th /></tr></thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id}>
                <td><strong>{product.name}</strong><br /><span>{labelArea(product.area)}</span></td>
                {!hideCategory && <td>{product.category}</td>}
                <td>{money(product.price)}</td>
                {!menuOnly && <td className={product.stock <= product.min ? styles.low : ""}>{product.stock}</td>}
                {!menuOnly && <td>{product.min}</td>}
                <td><div className={styles.rowActions}>{onAddStock && <button className={styles.stockButton} onClick={() => onAddStock(product)}>Agregar stock</button>}<button className={styles.smallButton} onClick={() => onEdit(product)}>Editar</button><button className={styles.smallButton} onClick={() => onDelete(product.id)}>Borrar</button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Panel({ title, action, children, sticky, narrow, variant }: { title: string; action?: React.ReactNode; children: React.ReactNode; sticky?: boolean; narrow?: boolean; variant?: "catalog" | "ticket" | "inventory" | "alert" }) {
  const variantClass = variant ? styles[`${variant}Panel`] : "";
  return <section className={`${styles.panel} ${sticky ? styles.sticky : ""} ${narrow ? styles.narrow : ""} ${variantClass}`}><div className={styles.panelHeader}><h2>{title}</h2>{action}</div>{children}</section>;
}

function ProductGrid({ products, onPick, compact, showStock = false, hideCategory = false }: { products: Product[]; onPick: (id: string) => void; compact?: boolean; showStock?: boolean; hideCategory?: boolean }) {
  if (!products.length) return <div className={styles.empty}>Sin resultados.</div>;
  return <div className={`${styles.productGrid} ${compact ? styles.compactGrid : ""}`}>{products.map((product) => {
    const out = product.area === "drugstore" && product.stock <= 0;
    return <button key={product.id} className={`${styles.productCard} ${out ? styles.out : ""}`} disabled={out} onClick={() => onPick(product.id)}><strong>{product.name}</strong><span>{hideCategory ? money(product.price) : `${product.category} - ${money(product.price)}`}</span>{showStock && <span>Stock: {product.stock}</span>}</button>;
  })}</div>;
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
  const isBar = draft.area === "bar";
  const isNewDrugstoreProduct = !isBar && !draft.id;
  return <div className={styles.modalBackdrop}><form className={styles.modal} onSubmit={(event) => { event.preventDefault(); onSave({ ...draft, stock: isBar ? 999999 : draft.stock, min: isBar ? 0 : draft.min }); }}><h2>{draft.id ? "Editar producto" : "Agregar producto"}</h2><label>Nombre<input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: formatName(event.target.value) })} /></label><label>Area<input value={labelArea(draft.area)} disabled /></label><div className={isBar ? styles.formGridSingle : styles.formGrid}><label>Precio<input type="number" min="0" value={draft.price || ""} onChange={(event) => setDraft({ ...draft, price: numberValue(event.target.value) })} /></label>{isNewDrugstoreProduct && <label>Stock inicial<input type="number" min="0" value={draft.stock || ""} onChange={(event) => setDraft({ ...draft, stock: numberValue(event.target.value) })} /></label>}{!isBar && <label>Minimo<input type="number" min="0" value={draft.min || ""} onChange={(event) => setDraft({ ...draft, min: numberValue(event.target.value) })} /></label>}</div><div className={styles.modalActions}><button type="button" className={styles.smallButton} onClick={onCancel}>Cancelar</button><button className={styles.primaryCompact}>Guardar</button></div></form></div>;
}

function StockModal({ product, onCancel, onSave }: { product: Product; onCancel: () => void; onSave: (quantity: number) => void }) {
  const [quantity, setQuantity] = useState("");
  return <div className={styles.modalBackdrop}><form className={styles.modal} onSubmit={(event) => { event.preventDefault(); onSave(Number(quantity)); }}><h2>Agregar stock</h2><div className={styles.stockSummary}><strong>{product.name}</strong><span>Stock actual: {product.stock}</span></div><label>Cantidad que ingresa<input autoFocus required type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="Ej: 12" /></label><div className={styles.modalActions}><button type="button" className={styles.smallButton} onClick={onCancel}>Cancelar</button><button className={styles.stockButton}>Sumar al stock</button></div></form></div>;
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

function DailyItems({ sales }: { sales: Sale[] }) {
  const items = new Map<string, { qty: number; total: number }>();
  sales.forEach((sale) => sale.items.forEach((item) => {
    const current = items.get(item.name) ?? { qty: 0, total: 0 };
    items.set(item.name, { qty: current.qty + item.qty, total: current.total + item.qty * item.price });
  }));
  const sorted = [...items.entries()].sort((a, b) => b[1].qty - a[1].qty);
  if (!sorted.length) return <div className={styles.empty}>No hubo ventas en esta fecha.</div>;
  return <div className={styles.dailyItems}>{sorted.map(([name, item]) => <div className={styles.dailyItem} key={name}><div><strong>{name}</strong><span>{item.qty} vendidos</span></div><strong>{money(item.total)}</strong></div>)}<Total label="Total del dia" value={sales.reduce((sum, sale) => sum + sale.total, 0)} /></div>;
}

function SalesTable({ title, sales, settings }: { title: string; sales: Sale[]; settings: AppState["settings"] }) {
  return (
    <Panel title={title}>
      <div className={styles.tableWrap}>
        <table>
          <thead><tr><th>Ticket</th><th>Fecha</th><th>Cliente</th><th>Pago</th><th>Total</th><th /></tr></thead>
          <tbody>
            {sales.slice().reverse().map((sale) => (
              <tr key={sale.id}><td>{sale.ticketNumber}</td><td>{date(sale.createdAt)}</td><td>{sale.customer}</td><td>{sale.payment}</td><td>{money(sale.total)}</td><td><button className={styles.smallButton} onClick={() => printTicket(settings, sale)}>Ticket</button></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <ListEmpty show={!sales.length} text="Sin facturacion registrada." />
    </Panel>
  );
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

function dateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isToday(value: string) {
  const dateValue = new Date(value);
  const now = new Date();
  return dateValue.getFullYear() === now.getFullYear() && dateValue.getMonth() === now.getMonth() && dateValue.getDate() === now.getDate();
}

function labelArea(area: Area) {
  return area === "bar" ? "Bar" : "Drugstore";
}

function statusLabel(status: TableStatus) {
  if (status === "vacio") return "Vacio";
  return status === "entregado" ? "Entregado" : "En preparacion";
}

function statusClass(status: TableStatus) {
  if (status === "vacio") return styles.emptyStatus;
  return status === "entregado" ? styles.delivered : styles.preparing;
}

function nextTicketNumber(sales: Sale[], area: Area) {
  const prefix = area === "bar" ? "B" : "D";
  const next = sales.filter((sale) => sale.area === area).length + 1;
  return `${prefix}-${String(next).padStart(4, "0")}`;
}

function nextTableName(tables: TableOrder[]) {
  const highest = tables.reduce((max, table) => {
    const number = Number(table.name.match(/\d+/)?.[0] ?? 0);
    return Math.max(max, number);
  }, 0);
  return `Mesa ${highest + 1}`;
}

function normalizeState(state: AppState): AppState {
  return {
    ...state,
    products: state.products.map((product) => product.area === "bar" ? { ...product, stock: product.stock || 999999, min: 0 } : product),
    sales: state.sales.map((sale, index) => ({ ...sale, ticketNumber: sale.ticketNumber || `${sale.area === "bar" ? "B" : "D"}-${String(index + 1).padStart(4, "0")}` })),
    tables: state.tables.map((table) => ({ ...table, status: table.items.length ? (table.status === "entregado" ? "entregado" : "preparacion") : "vacio" })),
  };
}

function normalize(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function formatName(value: string) {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function numberValue(value: string) {
  return value === "" ? 0 : Number(value);
}

function printTicket(settings: AppState["settings"], sale: Sale) {
  const old = document.getElementById("printTicket");
  old?.remove();
  const ticket = document.createElement("section");
  ticket.id = "printTicket";
  ticket.innerHTML = `<header><h2>${settings.businessName}</h2><p>${settings.businessAddress}</p>${settings.businessPhone ? `<p>${settings.businessPhone}</p>` : ""}</header><hr><div class="ticketMeta"><p>Ticket: ${sale.ticketNumber}</p><p>Fecha: ${date(sale.createdAt)}</p><p>Area: ${labelArea(sale.area)}</p><p>Cliente: ${sale.customer}</p></div><hr><div class="ticketItems">${sale.items.map((item) => `<div class="ticketItem"><strong>${item.name}</strong><div><span>${item.qty} x ${money(item.price)}</span><strong>${money(item.qty * item.price)}</strong></div></div>`).join("")}</div><hr><div class="ticketTotal"><span>TOTAL</span><strong>${money(sale.total)}</strong></div><p>Pago: ${sale.payment}</p><footer>${settings.ticketFooter}</footer>`;
  document.body.appendChild(ticket);
  window.requestAnimationFrame(() => window.print());
}
