import './style.css'
import { supabase } from './lib/supabase'

type Product = { id: number; name: string; sku: string; category: string; price: number; stock: number; min: number }
type Sale = { id: number; productId: number; productName: string; quantity: number; total: number; date: string }
type MovementKind = 'entry' | 'sale' | 'adjustment' | 'return'
type StockMovement = { id: string; productId: number; productName: string; sku: string; category: string; kind: MovementKind; delta: number; before: number; after: number; note: string; date: string; actor: string }
type Role = 'admin' | 'seller'

const starterProducts: Product[] = [
  { id: 1, name: 'Cuaderno profesional 100 hojas', sku: 'PAP-001', category: 'Papelería', price: 4.5, stock: 24, min: 8 },
  { id: 2, name: 'Pluma gel azul', sku: 'ESC-014', category: 'Escritura', price: 1.25, stock: 7, min: 10 },
  { id: 3, name: 'Novela: El principito', sku: 'LIB-008', category: 'Libros', price: 9.75, stock: 18, min: 5 },
  { id: 4, name: 'Resaltadores pastel x6', sku: 'ESC-022', category: 'Escritura', price: 6.25, stock: 3, min: 10 },
  { id: 5, name: 'Cartulina blanca pliego', sku: 'MAN-031', category: 'Manualidades', price: 0.9, stock: 40, min: 15 },
]
let products: Product[] = JSON.parse(localStorage.getItem('sv-products-ao') || JSON.stringify(starterProducts))
let sales: Sale[] = JSON.parse(localStorage.getItem('sv-sales-ao') || '[]')
let stockMovements: StockMovement[] = JSON.parse(localStorage.getItem('sv-stock-movements-ao') || '[]')
let lastPersistedStock = new Map(products.map((product) => [product.id, product.stock]))
let lastPersistedSalesCount = sales.length
let suppressMovementCapture = false
let pendingMovementNote = ''
let pendingMovementKind: MovementKind | null = null
let cloudMovementHistory = false
let movementSearch = ''
let movementTypeFilter = 'Todos'
let movementStartDate = ''
let movementEndDate = ''
let categories: string[] = JSON.parse(localStorage.getItem('sv-categories-ao') || JSON.stringify(['Papelería', 'Escritura', 'Libros', 'Manualidades', 'Otros']))
let currentRole: Role = 'seller'
let activeView = 'Inicio'
let authUser: { id: string; email?: string } | null = null
let reportStartDate = ''
let reportEndDate = ''

const localDateKey = (date = new Date()) => {
  const offset = date.getTimezoneOffset()
  const localDate = new Date(date.getTime() - offset * 60000)
  return localDate.toISOString().slice(0, 10)
}
const formatLongDate = (date = new Date()) => new Intl.DateTimeFormat('es-ES', {
  weekday: 'long',
  day: '2-digit',
  month: 'long',
  year: 'numeric'
}).format(date).replace(/^\w/, (char) => char.toUpperCase())

const money = (value: number) => `Bs ${value.toFixed(2)}`
function appendStockMovement(product: Product, kind: MovementKind, delta: number, before: number, note = '', date = new Date().toISOString(), id = `local-${crypto.randomUUID()}`) {
  stockMovements.unshift({ id, productId: product.id, productName: product.name, sku: product.sku, category: product.category, kind, delta, before, after: before + delta, note, date, actor: authUser?.email || roleName() })
}
function persist() {
  if (!suppressMovementCapture) {
    const isSale = sales.length > lastPersistedSalesCount
    products.forEach((product) => {
      const before = lastPersistedStock.get(product.id) ?? 0
      const delta = product.stock - before
      if (delta) appendStockMovement(product, pendingMovementKind || (isSale ? 'sale' : delta > 0 ? 'entry' : 'adjustment'), delta, before, pendingMovementNote)
    })
  }
  lastPersistedStock = new Map(products.map((product) => [product.id, product.stock]))
  lastPersistedSalesCount = sales.length
  pendingMovementNote = ''
  pendingMovementKind = null
  localStorage.setItem('sv-products-ao', JSON.stringify(products)); localStorage.setItem('sv-sales-ao', JSON.stringify(sales)); localStorage.setItem('sv-stock-movements-ao', JSON.stringify(stockMovements)); localStorage.setItem('sv-categories-ao', JSON.stringify(categories)); localStorage.setItem('sv-role-ao', currentRole)
}
const roleName = () => currentRole === 'admin' ? 'Administrador' : 'Vendedor'
const allowedViews = () => currentRole === 'admin' ? ['Inicio', 'Ventas', 'Productos', 'Inventario', 'Movimientos', 'Reportes'] : ['Inicio', 'Ventas']
const icon = (value: string) => `<span class="nav-icon">${value}</span>`
const getReportRange = () => {
  const orderedDates = sales.map((sale) => sale.date).sort()
  const minDate = orderedDates[0] || localDateKey()
  const maxDate = orderedDates[orderedDates.length - 1] || localDateKey()
  return {
    start: reportStartDate || minDate,
    end: reportEndDate || maxDate,
  }
}
const filterSalesByRange = (startDate: string, endDate: string) => sales.filter((sale) => {
  if (startDate && sale.date < startDate) return false
  if (endDate && sale.date > endDate) return false
  return true
}).sort((a, b) => b.date.localeCompare(a.date))
const showToast = (message: string, type: 'success' | 'error' = 'success') => {
  const existing = document.querySelector<HTMLElement>('#toast')
  if (existing) existing.remove()
  const toast = document.createElement('div')
  toast.id = 'toast'
  toast.className = `toast ${type}`
  toast.textContent = message
  document.body.appendChild(toast)
  window.setTimeout(() => toast.classList.add('visible'), 20)
  window.setTimeout(() => {
    toast.classList.remove('visible')
    setTimeout(() => toast.remove(), 250)
  }, 2600)
}
const normalizeProductInput = (values: FormData, existingId?: number) => {
  const name = String(values.get('name') || '').trim()
  const sku = String(values.get('sku') || '').trim().toUpperCase()
  const category = String(values.get('category') || '').trim()
  const price = Number(values.get('price'))
  const stock = Number(values.get('stock'))
  const min = Number(values.get('min'))
  if (!name || !sku || !category) throw new Error('Completa nombre, SKU y categoría.')
  if (!Number.isFinite(price) || price <= 0) throw new Error('El precio debe ser mayor a cero.')
  if (!Number.isFinite(stock) || stock < 0) throw new Error('El stock no puede ser negativo.')
  if (!Number.isFinite(min) || min < 0) throw new Error('El stock mínimo no puede ser negativo.')
  const duplicate = products.some((product) => product.id !== existingId && product.sku.toLowerCase() === sku.toLowerCase())
  if (duplicate) throw new Error(`El SKU ${sku} ya existe en el catálogo.`)
  return { name, sku, category, price, stock, min }
}

function renderLogin(message = '') { document.querySelector<HTMLDivElement>('#app')!.innerHTML = `<main class="login-page"><section class="login-card"><div class="login-brand"><div class="brand-mark">A&O</div><strong>Librería A&O</strong></div><p class="eyebrow">ACCESO SEGURO</p><h1>Bienvenido</h1><p class="subtle">Ingresa para administrar ventas e inventario.</p><form id="login-form"><label>Correo electrónico<input name="email" type="email" autocomplete="email" placeholder="tu-correo@ejemplo.com" required></label><label>Contraseña<input name="password" type="password" autocomplete="current-password" placeholder="Tu contraseña" required></label>${message ? `<p class="auth-error">${message}</p>` : ''}<button class="primary full" type="submit">Ingresar</button></form><p class="login-help">El usuario debe estar creado en Supabase Authentication.</p></section></main>`; document.querySelector<HTMLFormElement>('#login-form')!.addEventListener('submit', handleLogin) }
async function handleLogin(event: SubmitEvent) { event.preventDefault(); if (!supabase) return renderLogin('Supabase no está configurado.'); const form = event.target as HTMLFormElement; const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!; submit.disabled = true; submit.textContent = 'Ingresando...'; const data = new FormData(form); try { const { data: result, error } = await supabase.auth.signInWithPassword({ email: String(data.get('email')).trim(), password: String(data.get('password')) }); if (error) return renderLogin(error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : error.message); authUser = result.user ? { id: result.user.id, email: result.user.email } : null; await loadRole(); render() } catch { renderLogin('No se pudo conectar con Supabase. Revisa la configuración del proyecto.') } }
async function loadRole() { if (!supabase || !authUser) return; const { data } = await supabase.from('profiles').select('role').eq('id', authUser.id).maybeSingle(); currentRole = data?.role === 'admin' ? 'admin' : 'seller' }
async function signOut() { if (supabase) await supabase.auth.signOut(); authUser = null; currentRole = 'seller'; activeView = 'Inicio'; renderLogin() }
async function loadCloudData() { if (!supabase) return; const { data: cloudProducts } = await supabase.from('products').select('id,name,sku,price,stock,min_stock,category:categories(name)').order('id'); const { data: cloudCategories } = await supabase.from('categories').select('name').order('name'); const { data: cloudSales } = await supabase.from('sales').select('id,total,created_at,sale_items(quantity,product_id,products(name))').order('created_at', { ascending: false }); if (cloudProducts?.length) products = cloudProducts.map((item: any) => ({ id: item.id, name: item.name, sku: item.sku, category: item.category?.name || 'Otros', price: Number(item.price), stock: item.stock, min: item.min_stock })); if (cloudCategories?.length) categories = cloudCategories.map((item) => item.name); if (cloudSales) sales = cloudSales.flatMap((sale: any) => (sale.sale_items || []).map((item: any) => ({ id: sale.id + item.product_id, productId: item.product_id, productName: item.products?.name || 'Producto', quantity: item.quantity, total: Number(sale.total), date: localDateKey(new Date(sale.created_at)) }))); lastCloudSalesCount = sales.length; lastSalesCount = sales.length; persist() }
async function loadCloudMovements() {
  if (!supabase) return
  const { data, error } = await supabase.from('stock_movements').select('*').order('created_at', { ascending: false }).limit(500)
  if (error || !data) { cloudMovementHistory = false; return }
  stockMovements = data.map((movement: any) => ({
    id: String(movement.id), productId: movement.product_id, productName: movement.product_name,
    sku: movement.sku, category: movement.category_name, kind: movement.movement_type,
    delta: movement.quantity_delta, before: movement.stock_before, after: movement.stock_after,
    note: movement.note || '', date: movement.created_at, actor: movement.actor_label || 'Usuario',
  }))
  cloudMovementHistory = true
  persist()
}
async function syncCatalog() { if (!supabase || currentRole !== 'admin') return null; const categoryResult = await supabase.from('categories').upsert(categories.map((name) => ({ name })), { onConflict: 'name' }); if (categoryResult.error) throw new Error(`No se pudieron guardar las categorías: ${categoryResult.error.message}`); const { data: cloudCategories, error: categoryReadError } = await supabase.from('categories').select('id,name'); if (categoryReadError) throw new Error(`No se pudieron leer las categorías: ${categoryReadError.message}`); const categoryIds = new Map((cloudCategories || []).map((item) => [item.name, item.id])); const productResult = await supabase.from('products').upsert(products.map((product) => ({ id: product.id, name: product.name, sku: product.sku, category_id: categoryIds.get(product.category), price: product.price, stock: product.stock, min_stock: product.min })), { onConflict: 'sku' }); if (productResult.error) throw new Error(`No se pudieron guardar los productos: ${productResult.error.message}`); return true }
async function syncNewSales() { if (!supabase || !authUser) return; const pending = sales.slice(lastCloudSalesCount); for (const sale of pending) { const { error } = await supabase.rpc('create_sale', { items: [{ product_id: sale.productId, quantity: sale.quantity }] }); if (error) throw new Error(`No se pudo guardar la venta: ${error.message}`) } lastCloudSalesCount = sales.length }
async function syncCloudWithFeedback() { try { await syncCatalog() } catch (error) { alert(error instanceof Error ? error.message : 'No se pudieron sincronizar los datos con Supabase.') } }
async function initializeAuth() {
  if (!supabase) return renderLogin('Configura Supabase para iniciar sesión.')
  const { data } = await supabase.auth.getSession()
  if (!data.session?.user) return renderLogin()
  authUser = { id: data.session.user.id, email: data.session.user.email }
  await loadRole()
  suppressMovementCapture = true
  try { await loadCloudData() } finally { suppressMovementCapture = false }
  await loadCloudMovements()
  render()
}

function render() {
  if (!allowedViews().includes(activeView)) activeView = 'Ventas'
  const todayDateKey = localDateKey()
  const todaySales = sales.filter((sale) => sale.date === todayDateKey)
  const revenue = todaySales.reduce((sum, sale) => sum + sale.total, 0)
  const lowStock = products.filter((product) => product.stock <= product.min)
  const content = activeView === 'Inicio' ? dashboard(revenue, todaySales.length, lowStock) : activeView === 'Ventas' ? salesView() : activeView === 'Productos' ? productsView() : activeView === 'Inventario' ? inventoryView() : activeView === 'Movimientos' ? movementHistoryView() : reportsView()
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><div class="brand-mark">A&O</div><div><strong>Librería A&O</strong><small>papelería y libros</small></div></div><nav>${['Inicio', 'Ventas', 'Productos', 'Inventario', 'Reportes'].map((item) => `<button class="nav-item ${activeView === item ? 'active' : ''}" data-view="${item}">${icon({ Inicio: '⌂', Ventas: '↗', Productos: '▦', Inventario: '◫', Reportes: '▥' }[item] || '')}<span>${item}</span></button>`).join('')}</nav><div class="sidebar-foot"><div class="avatar">AO</div><div><strong>${roleName()}</strong><small>Sesión local</small></div><button class="more">•••</button></div></aside><main><header><div><p class="eyebrow">${formatLongDate()}</p><h1>${activeView === 'Inicio' ? 'Buenos días, A&O' : activeView}</h1></div><div class="header-actions"><div class="profile-menu"><button class="profile" data-action="sign-out" aria-label="Cerrar sesión" title="Cerrar sesión">AO <span aria-hidden="true">↪</span></button></div></div></header>${content}</main></div><div id="modal-root"></div>`
  if (currentRole === 'admin') document.querySelector('nav')?.insertAdjacentHTML('beforeend', `<button class="nav-item ${activeView === 'Movimientos' ? 'active' : ''}" data-view="Movimientos">${icon('⇄')}<span>Movimientos</span></button>`)
  bindEvents()
  applyRoleAccess()
}

function applyRoleAccess() {
  document.querySelector<HTMLElement>('.more')?.remove()
  document.querySelector<HTMLElement>('.role-menu')?.remove()
  const previousProfileButton = document.querySelector<HTMLElement>('.profile')
  if (previousProfileButton) {
    const signOutButton = previousProfileButton.cloneNode(true) as HTMLButtonElement
    signOutButton.dataset.action = 'sign-out'
    signOutButton.removeAttribute('aria-expanded')
    signOutButton.setAttribute('aria-label', 'Cerrar sesión')
    signOutButton.title = 'Cerrar sesión'
    signOutButton.innerHTML = 'AO <span aria-hidden="true">↪</span>'
    signOutButton.addEventListener('click', () => signOut())
    previousProfileButton.replaceWith(signOutButton)
  }
  if (currentRole === 'seller') {
    document.querySelectorAll<HTMLElement>('[data-view]').forEach((item) => {
      if (['Productos', 'Inventario', 'Movimientos', 'Reportes'].includes(item.dataset.view || '')) item.remove()
    })
  }
}

function dashboard(revenue: number, count: number, lowStock: Product[]) { return `<section class="welcome-row"><div><p class="subtle">Resumen de tu negocio</p></div><button class="primary" data-action="new-sale">+ Nueva venta</button></section><div class="metric-grid"><article class="metric-card mint"><span>Ventas de hoy</span><strong>${money(revenue)}</strong><small class="positive">↑ ${count ? '12.4%' : '0%'} <em>vs. ayer</em></small><div class="sparkline">▁▂▁▃▂▄▃▅▆</div></article><article class="metric-card yellow"><span>Productos activos</span><strong>${products.length}</strong><small>de 100 disponibles</small><div class="progress"><i style="width:${products.length}%"></i></div></article><article class="metric-card coral"><span>Stock por reponer</span><strong>${lowStock.length}</strong><small class="warning">Requieren atención</small><div class="stock-dots">● ● ● ● ● ●</div></article></div><div class="dashboard-grid"><section class="panel sales-panel"><div class="panel-head"><div><h2>Actividad reciente</h2><p>Últimas ventas registradas</p></div><button class="text-button" data-view="Ventas">Ver todas →</button></div>${sales.length ? `<div class="sale-list">${sales.slice(-5).reverse().map(saleRow).join('')}</div>` : emptyState('Aún no hay ventas', 'Registra tu primera venta para verla aquí.')}</section><section class="panel"><div class="panel-head"><div><h2>Atención rápida</h2><p>Productos con stock bajo</p></div><button class="text-button" data-view="Inventario">Ver inventario →</button></div>${lowStock.length ? `<div class="low-list">${lowStock.slice(0, 4).map((product) => `<div class="low-item"><div class="product-avatar">${product.name.charAt(0)}</div><div><strong>${product.name}</strong><small>${product.sku}</small></div><b class="stock-badge">${product.stock} uds.</b></div>`).join('')}</div>` : emptyState('Todo en orden', 'No tienes productos por debajo del mínimo.')}</section></div>` }
function saleRow(sale: Sale) { return `<div class="sale-row"><div class="sale-symbol">↗</div><div><strong>${sale.productName}</strong><small>${sale.quantity} unidad${sale.quantity > 1 ? 'es' : ''} · ${sale.date}</small></div><b>${money(sale.total)}</b></div>` }
function emptyState(title: string, text: string) { return `<div class="empty"><span>◌</span><strong>${title}</strong><p>${text}</p></div>` }
function salesView() { return `<section class="view-toolbar"><div><p class="subtle">Registra salidas y mantén tus números al día.</p></div><button class="primary" data-action="new-sale">+ Nueva venta</button></section><section class="panel table-panel"><div class="panel-head"><div><h2>Historial de ventas</h2><p>${sales.length} operaciones registradas</p></div><button class="outline" data-action="export">↓ Exportar</button></div>${sales.length ? `<div class="table-wrap"><table><thead><tr><th>Producto</th><th>Fecha</th><th>Cantidad</th><th>Total</th></tr></thead><tbody>${sales.slice().reverse().map((sale) => `<tr><td><strong>${sale.productName}</strong></td><td>${sale.date}</td><td>${sale.quantity}</td><td><b>${money(sale.total)}</b></td></tr>`).join('')}</tbody></table></div>` : emptyState('Sin ventas todavía', 'Usa “Nueva venta” para comenzar.')}</section>` }
function getProductGroups(search = '', category = 'Todas') {
  const term = search.toLowerCase().trim()
  const matchingProducts = products.filter((product) =>
    (category === 'Todas' || product.category === category) &&
    `${product.name} ${product.sku}`.toLowerCase().includes(term)
  )
  const groupNames = [...new Set([...categories, ...products.map((product) => product.category)])]
    .filter((name) => matchingProducts.some((product) => product.category === name))
  return groupNames.map((name) => ({
    name,
    products: matchingProducts.filter((product) => product.category === name)
      .sort((a, b) => a.name.localeCompare(b.name, 'es')),
  }))
}
function productsView() { return `<section class="view-toolbar"><div><p class="subtle">Administra precios, categorías y existencias.</p></div><button class="primary" data-action="new-product">+ Agregar producto</button></section><section class="panel table-panel"><div class="panel-head"><div><h2>Catálogo de productos</h2><p>${products.length} productos en ${new Set(products.map((product) => product.category)).size} categorías</p></div><input class="search" id="product-search" placeholder="⌕  Buscar producto o SKU..." /></div><div class="table-wrap"><table><thead><tr><th>Producto</th><th>SKU</th><th>Categoría</th><th>Precio</th><th>Stock</th><th></th></tr></thead><tbody id="product-rows">${renderProductRows()}</tbody></table></div></section>` }
function renderProductRows(search = '') {
  const groups = getProductGroups(search)
  if (!groups.length) return '<tr><td colspan="6"><div class="empty"><strong>No hay productos coincidentes</strong><p>Prueba otro nombre, SKU o categoría.</p></div></td></tr>'
  return groups.map((group) => `<tr class="category-divider"><th colspan="6"><span>${group.name}</span><small>${group.products.length} producto${group.products.length === 1 ? '' : 's'}</small></th></tr>${group.products.map(productRow).join('')}`).join('')
}
function productRow(product: Product) { return `<tr><td><strong>${product.name}</strong></td><td class="muted">${product.sku}</td><td><span class="category">${product.category}</span></td><td>${money(product.price)}</td><td><b class="${product.stock <= product.min ? 'stock-low' : 'stock-ok'}">${product.stock} uds.</b></td><td><button class="row-action" data-edit="${product.id}">Editar</button></td></tr>` }
function inventoryRows(search = '', category = 'Todas', status = 'Todos') {
  const groups = getProductGroups(search, category).map((group) => ({
    ...group,
    products: group.products.filter((product) => status === 'Todos' || (status === 'Bajo' ? product.stock > 0 && product.stock <= product.min : status === 'Agotado' ? product.stock === 0 : product.stock > product.min)),
  })).filter((group) => group.products.length)
  if (!groups.length) return '<div class="empty"><strong>No hay productos para estos filtros</strong><p>Cambia la categoría, búsqueda o estado de stock.</p></div>'
  return groups.map((group) => `<section class="inventory-category"><header><div><h3>${group.name}</h3><p>${group.products.length} producto${group.products.length === 1 ? '' : 's'}</p></div><strong>${group.products.reduce((sum, product) => sum + product.stock, 0)} uds.</strong></header><div class="inventory-bars">${group.products.map((product) => `<div class="bar-row"><div class="inventory-product"><strong>${product.name}</strong><small>${product.sku} · mínimo ${product.min}</small></div><div class="bar"><i class="${product.stock <= product.min ? 'low' : ''}" style="width:${Math.min(product.stock / Math.max(product.min * 2, 1) * 100, 100)}%"></i></div><b class="${product.stock <= product.min ? 'stock-low' : 'stock-ok'}">${product.stock} uds.</b></div>`).join('')}</div></section>`).join('')
}
function inventoryView() { const value = products.reduce((sum, product) => sum + product.stock * product.price, 0); return `<section class="metric-grid compact"><article class="metric-card white"><span>Valor del inventario</span><strong>${money(value)}</strong><small>Precio de venta estimado</small></article><article class="metric-card white"><span>Unidades totales</span><strong>${products.reduce((sum, p) => sum + p.stock, 0)}</strong><small>En ${products.length} productos</small></article><article class="metric-card white"><span>Alertas activas</span><strong>${products.filter((p) => p.stock <= p.min).length}</strong><small class="warning">Stock bajo o agotado</small></article></section><section class="panel table-panel inventory-panel"><div class="panel-head"><div><h2>Control de existencias</h2><p>Productos ordenados por categoría</p></div><div class="inventory-filters"><input class="search" id="inventory-search" placeholder="⌕  Buscar producto o SKU..." /><select class="search" id="inventory-category"><option value="Todas">Todas las categorías</option>${[...new Set([...categories, ...products.map((product) => product.category)])].map((name) => `<option value="${name}">${name}</option>`).join('')}</select><select class="search" id="inventory-status"><option value="Todos">Todos los estados</option><option value="Normal">Stock normal</option><option value="Bajo">Stock bajo</option><option value="Agotado">Agotados</option></select></div></div><div id="inventory-groups">${inventoryRows()}</div></section>` }
const movementLabels: Record<MovementKind, string> = { entry: 'Entrada', sale: 'Venta', adjustment: 'Ajuste', return: 'Devolución' }
function filteredStockMovements() {
  const term = movementSearch.trim().toLowerCase()
  return stockMovements.filter((movement) => {
    const date = movement.date.slice(0, 10)
    return (movementTypeFilter === 'Todos' || movement.kind === movementTypeFilter) &&
      (!movementStartDate || date >= movementStartDate) && (!movementEndDate || date <= movementEndDate) &&
      (!term || `${movement.productName} ${movement.sku} ${movement.note} ${movement.actor}`.toLowerCase().includes(term))
  })
}
function renderMovementRows() {
  const rows = filteredStockMovements()
  if (!rows.length) return '<tr><td colspan="7"><div class="empty"><strong>No hay movimientos para mostrar</strong><p>Prueba otros filtros o registra una entrada de stock.</p></div></td></tr>'
  return rows.map((movement) => `<tr><td>${new Intl.DateTimeFormat('es-BO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(movement.date))}</td><td><strong>${movement.productName}</strong><small class="movement-subline">${movement.sku} · ${movement.category}</small></td><td><span class="movement-type ${movement.kind}">${movementLabels[movement.kind]}</span></td><td class="movement-delta ${movement.delta < 0 ? 'negative' : 'positive'}">${movement.delta > 0 ? '+' : ''}${movement.delta} uds.</td><td>${movement.before} → ${movement.after}</td><td>${movement.note || '—'}</td><td>${movement.actor}</td></tr>`).join('')
}
function movementHistoryView() {
  const migrationNotice = supabase && !cloudMovementHistory ? '<p class="movement-notice">Mostrando movimientos guardados en este dispositivo. Para sincronizar el historial entre usuarios, aplica la migración SQL del proyecto.</p>' : ''
  return `<section class="view-toolbar"><div><p class="subtle">Trazabilidad de entradas, ventas, ajustes y devoluciones.</p></div><button class="primary" data-action="new-stock-movement">+ Registrar movimiento</button></section><section class="panel table-panel movement-panel"><div class="panel-head"><div><h2>Historial de inventario</h2><p class="movement-count">${filteredStockMovements().length} movimientos listados</p></div><div class="movement-filters"><input class="search" data-movement-filter="search" value="${movementSearch}" placeholder="⌕ Producto, SKU o nota..." /><select class="search" data-movement-filter="type"><option value="Todos">Todos los tipos</option>${Object.entries(movementLabels).map(([value, label]) => `<option value="${value}" ${movementTypeFilter === value ? 'selected' : ''}>${label}</option>`).join('')}</select><label>Desde<input class="search" data-movement-filter="start" type="date" value="${movementStartDate}" /></label><label>Hasta<input class="search" data-movement-filter="end" type="date" value="${movementEndDate}" /></label></div></div>${migrationNotice}<div class="table-wrap"><table class="movement-table"><thead><tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th>Cambio</th><th>Stock</th><th>Motivo</th><th>Usuario</th></tr></thead><tbody id="movement-rows">${renderMovementRows()}</tbody></table></div></section>`
}
function showStockMovementModal() {
  const options = products.map((product) => `<option value="${product.id}">${product.name} · ${product.sku} · ${product.stock} uds.</option>`).join('')
  document.querySelector<HTMLElement>('#modal-root')!.innerHTML = `<div class="modal-backdrop"><div class="modal"><button class="close" data-action="close" aria-label="Cerrar">×</button><p class="eyebrow">INVENTARIO</p><h2>Registrar movimiento</h2><p class="subtle">El ajuste acepta cantidades positivas o negativas.</p><form id="stock-movement-form" data-kind="stock"><label>Producto<select name="productId" required>${options}</select></label><label>Tipo de movimiento<select name="kind"><option value="entry">Entrada</option><option value="adjustment">Ajuste de inventario</option><option value="return">Devolución</option></select></label><label>Cantidad<input name="delta" type="number" step="1" value="1" required></label><label>Motivo<input name="note" maxlength="200" placeholder="Ej. Reposición de proveedor" /></label><div class="form-actions"><button class="outline" type="button" data-action="close">Cancelar</button><button class="primary" type="submit">Guardar movimiento</button></div></form></div></div>`
  document.querySelector<HTMLFormElement>('#stock-movement-form')!.addEventListener('submit', handleStockMovementSubmit)
  document.querySelectorAll<HTMLElement>('[data-action="close"]').forEach((button) => button.addEventListener('click', closeModal))
  document.querySelector<HTMLElement>('.modal-backdrop')!.addEventListener('click', (event) => { if (event.target === event.currentTarget) closeModal() })
}
async function handleStockMovementSubmit(event: SubmitEvent) {
  event.preventDefault()
  const form = event.currentTarget as HTMLFormElement
  const values = new FormData(form)
  const product = products.find((item) => item.id === Number(values.get('productId')))
  const kind = String(values.get('kind')) as MovementKind
  const delta = Number(values.get('delta'))
  const note = String(values.get('note') || '').trim()
  if (!product || !Number.isInteger(delta) || delta === 0) return showToast('Selecciona un producto y una cantidad entera distinta de cero.', 'error')
  if (kind !== 'adjustment' && delta < 1) return showToast('Las entradas y devoluciones deben ser cantidades positivas.', 'error')
  if (product.stock + delta < 0) return showToast(`El ajuste dejaría el stock de ${product.name} por debajo de cero.`, 'error')
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!
  submit.disabled = true
  let needsCatalogFallback = false
  let syncWarning = ''
  try {
    if (supabase) {
      const { error } = await supabase.rpc('record_stock_change', { p_product_id: product.id, p_delta: delta, p_movement_type: kind, p_note: note })
      if (error && ['PGRST202', '42883'].includes(error.code || '')) needsCatalogFallback = true
      else if (error) throw new Error(error.message)
    }
    pendingMovementKind = kind
    pendingMovementNote = note
    product.stock += delta
    persist()
    if (needsCatalogFallback && supabase) {
      try { await syncCatalog() }
      catch (error) { syncWarning = error instanceof Error ? `El movimiento quedó guardado localmente: ${error.message}` : 'El movimiento quedó guardado localmente, pero no se sincronizó.' }
    }
    closeModal()
    render()
    showToast(syncWarning || 'Movimiento de inventario registrado.', syncWarning ? 'error' : 'success')
  } catch (error) {
    submit.disabled = false
    showToast(error instanceof Error ? `No se sincronizó el movimiento con Supabase: ${error.message}` : 'No se pudo registrar el movimiento.', 'error')
  }
}
function refreshMovementRows() {
  const rows = document.querySelector<HTMLElement>('#movement-rows')
  if (rows) rows.innerHTML = renderMovementRows()
  const count = document.querySelector<HTMLElement>('.movement-count')
  if (count) count.textContent = `${filteredStockMovements().length} movimientos listados`
}
function updateMovementFilter(target: HTMLInputElement | HTMLSelectElement) {
  const value = target.value
  if (target.dataset.movementFilter === 'search') movementSearch = value
  if (target.dataset.movementFilter === 'type') movementTypeFilter = value
  if (target.dataset.movementFilter === 'start') movementStartDate = value
  if (target.dataset.movementFilter === 'end') movementEndDate = value
  refreshMovementRows()
}
function reportsView() {
  const { start, end } = getReportRange()
  const filteredSales = filterSalesByRange(start, end)
  const total = filteredSales.reduce((sum, sale) => sum + sale.total, 0)
  const units = filteredSales.reduce((sum, sale) => sum + sale.quantity, 0)
  const averageTicket = filteredSales.length ? total / filteredSales.length : 0
  const productMetricMap = filteredSales.reduce((map, sale) => {
    const existing = map.get(sale.productId) ?? { product: products.find((product) => product.id === sale.productId), quantity: 0, revenue: 0 }
    existing.quantity += sale.quantity
    existing.revenue += sale.total
    map.set(sale.productId, existing)
    return map
  }, new Map<number, { product: Product | undefined; quantity: number; revenue: number }>() )
  const topProducts = Array.from(productMetricMap.values())
    .filter((entry) => entry.product)
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 5)
  const maxQuantity = topProducts[0]?.quantity || 1

  return `<section class="panel report-panel"><div class="panel-head"><div><h2>Reportes avanzados</h2><p>Control por período y desempeño del catálogo</p></div><button class="outline" data-action="export">↓ Descargar CSV</button></div><div class="report-filters"><label>Desde<input id="report-start" type="date" value="${start}" /></label><label>Hasta<input id="report-end" type="date" value="${end}" /></label><button class="outline small" data-action="reset-report-range" type="button">Reset</button></div><div class="metric-grid compact"><article class="metric-card mint"><span>Ventas del período</span><strong>${money(total)}</strong><small>${filteredSales.length} transacciones</small></article><article class="metric-card yellow"><span>Unidades vendidas</span><strong>${units}</strong><small>Productos despachados</small></article><article class="metric-card white"><span>Ticket promedio</span><strong>${money(averageTicket)}</strong><small>Por operación</small></article></div>${filteredSales.length ? `<div class="report-grid"><div class="report-card"><div class="report-card-head"><h3>Productos más vendidos</h3></div><div class="report-bars">${topProducts.map((entry, index) => `<div class="report-bar"><span>${index + 1}</span><strong>${entry.product?.name || 'Producto'}</strong><i style="width:${Math.max(12, (entry.quantity / maxQuantity) * 100)}%"></i><b>${entry.quantity} u.</b></div>`).join('')}</div></div><div class="report-card"><div class="report-card-head"><h3>Resumen de ventas</h3></div><div class="summary-list"><div><span>Periodo</span><strong>${start} → ${end}</strong></div><div><span>Total bruto</span><strong>${money(total)}</strong></div><div><span>Promedio</span><strong>${money(averageTicket)}</strong></div><div><span>Productos con movimiento</span><strong>${topProducts.length}</strong></div></div></div></div>` : emptyState('Sin datos para reportar', 'No hay ventas dentro del rango seleccionado.')}</section>` }

function saleOptions(search = '', category = 'Todas') { const term = search.toLowerCase().trim(); return products.filter((product) => product.stock > 0 && (category === 'Todas' || product.category === category) && `${product.name} ${product.sku}`.toLowerCase().includes(term)).map((product) => `<option value="${product.id}">${product.name} · ${money(product.price)} · ${product.stock} disponibles</option>`).join('') }
function showModal(kind: 'sale' | 'product', id?: number) { const product = id ? products.find((item) => item.id === id) : undefined; const isSale = kind === 'sale'; const categoryOptions = categories.map((category) => `<option>${category}</option>`).join('') + '<option value="__new__">+ Nueva categoría...</option>'; const saleCategories = ['Todas', ...categories].map((category) => `<option>${category}</option>`).join(''); document.querySelector('#modal-root')!.innerHTML = `<div class="modal-backdrop"><div class="modal"><button class="close" data-action="close" aria-label="Cerrar">×</button><p class="eyebrow">${isSale ? 'OPERACIÓN' : 'CATÁLOGO'}</p><h2>${isSale ? 'Registrar venta' : product ? 'Editar producto' : 'Agregar producto'}</h2><p class="subtle">${isSale ? 'Filtra el catálogo para encontrar un producto rápidamente.' : 'Mantén tu catálogo claro y preciso.'}</p><form id="modal-form" data-kind="${kind}" data-id="${id || ''}">${isSale ? `<div class="sale-filters"><input id="sale-search" placeholder="⌕ Buscar por nombre o SKU..." /><select id="sale-category"><option value="Todas">Todas las categorías</option>${saleCategories}</select></div><label>Producto<select name="productId" id="sale-product" required>${saleOptions()}</select></label><label>Cantidad<input name="quantity" type="number" min="1" value="1" required></label>` : `<label>Nombre del producto<input name="name" value="${product?.name || ''}" placeholder="Ej. Agenda escolar" required></label><div class="form-grid"><label>SKU<input name="sku" value="${product?.sku || ''}" placeholder="ALI-001" required></label><label>Categoría<select name="category" id="category-select">${categoryOptions}</select><input name="newCategory" id="new-category" placeholder="Nombre de la nueva categoría" hidden></label></div><div class="form-grid"><label>Precio<input name="price" type="number" step="0.01" value="${product?.price || ''}" required></label><label>Stock inicial<input name="stock" type="number" min="0" value="${product?.stock ?? ''}" required></label></div><label>Stock mínimo<input name="min" type="number" min="0" value="${product?.min ?? 5}" required></label>`}<div class="form-actions"><button class="outline" type="button" data-action="close">Cancelar</button><button class="primary" type="submit">${isSale ? 'Confirmar venta' : 'Guardar producto'}</button></div></form></div></div>`; document.querySelector<HTMLFormElement>('#modal-form')!.addEventListener('submit', handleSubmit); document.querySelectorAll<HTMLElement>('[data-action="close"]').forEach((button) => button.addEventListener('click', closeModal)); document.querySelector<HTMLElement>('.modal-backdrop')!.addEventListener('click', (event) => { if (event.target === event.currentTarget) closeModal() }); document.querySelector<HTMLSelectElement>('#category-select')?.addEventListener('change', (event) => { const select = event.target as HTMLSelectElement; const input = document.querySelector<HTMLInputElement>('#new-category')!; input.hidden = select.value !== '__new__'; input.required = select.value === '__new__'; if (input.required) input.focus() }); const refreshSaleOptions = () => { const search = document.querySelector<HTMLInputElement>('#sale-search')!; const category = document.querySelector<HTMLSelectElement>('#sale-category')!; document.querySelector<HTMLSelectElement>('#sale-product')!.innerHTML = saleOptions(search.value, category.value) }; document.querySelector<HTMLInputElement>('#sale-search')?.addEventListener('input', refreshSaleOptions); document.querySelector<HTMLSelectElement>('#sale-category')?.addEventListener('change', refreshSaleOptions); document.addEventListener('keydown', handleEscape, { once: true }) }

function closeModal() { document.querySelector('#modal-root')!.innerHTML = '' }
function handleEscape(event: KeyboardEvent) { if (event.key === 'Escape') closeModal() }

function bindEvents() { document.querySelectorAll<HTMLElement>('[data-view]').forEach((element) => element.addEventListener('click', () => { activeView = element.dataset.view || 'Inicio'; render() })); document.querySelectorAll<HTMLElement>('[data-action="new-sale"]').forEach((button) => button.addEventListener('click', () => showModal('sale'))); document.querySelectorAll<HTMLElement>('[data-action="new-product"]').forEach((button) => button.addEventListener('click', () => showModal('product'))); document.querySelectorAll<HTMLElement>('[data-edit]').forEach((button) => button.addEventListener('click', () => showModal('product', Number(button.dataset.edit)))); document.querySelectorAll<HTMLElement>('[data-action="close"]').forEach((button) => button.addEventListener('click', () => document.querySelector('#modal-root')!.innerHTML = '')); document.querySelector<HTMLFormElement>('#modal-form')?.addEventListener('submit', handleSubmit); document.querySelector<HTMLElement>('[data-action="export"]')?.addEventListener('click', exportCsv); document.querySelector<HTMLInputElement>('#product-search')?.addEventListener('input', (event) => { const term = (event.target as HTMLInputElement).value.toLowerCase(); document.querySelector('#product-rows')!.innerHTML = products.filter((p) => `${p.name} ${p.sku}`.toLowerCase().includes(term)).map(productRow).join('') }); document.querySelector<HTMLElement>('[data-action="toggle-profile"]')?.addEventListener('click', () => { const menu = document.querySelector<HTMLElement>('.role-menu')!; const button = document.querySelector<HTMLElement>('[data-action="toggle-profile"]')!; menu.hidden = !menu.hidden; button.setAttribute('aria-expanded', String(!menu.hidden)) }); document.querySelectorAll<HTMLElement>('[data-role]').forEach((button) => button.addEventListener('click', () => { currentRole = button.dataset.role as Role; persist(); render() })); document.querySelector<HTMLInputElement>('#report-start')?.addEventListener('change', (event) => { reportStartDate = (event.target as HTMLInputElement).value; render() }); document.querySelector<HTMLInputElement>('#report-end')?.addEventListener('change', (event) => { reportEndDate = (event.target as HTMLInputElement).value; render() }); document.querySelector<HTMLElement>('[data-action="reset-report-range"]')?.addEventListener('click', () => { reportStartDate = ''; reportEndDate = ''; render() }) }
function handleSubmit(event: SubmitEvent) { event.preventDefault(); const form = event.target as HTMLFormElement; const data = new FormData(form); try { if (form.dataset.kind === 'sale') { const product = products.find((p) => p.id === Number(data.get('productId'))); const quantity = Number(data.get('quantity')); if (!product) throw new Error('Selecciona un producto válido.'); if (!Number.isFinite(quantity) || quantity < 1) throw new Error('La cantidad debe ser mayor a cero.'); if (quantity > product.stock) throw new Error(`Solo hay ${product.stock} unidades disponibles.`); product.stock -= quantity; sales.push({ id: Date.now(), productId: product.id, productName: product.name, quantity, total: product.price * quantity, date: localDateKey() }); showToast('Venta registrada correctamente.', 'success'); } else { const newCategory = String(data.get('newCategory') || '').trim(); const category = newCategory || String(data.get('category') || '').trim(); if (!category) throw new Error('Debes elegir o crear una categoría.'); if (newCategory && !categories.includes(newCategory)) categories.push(newCategory); const values = normalizeProductInput(data, Number(form.dataset.id) || undefined); const id = Number(form.dataset.id); if (id) products = products.map((p) => p.id === id ? { ...p, ...values } : p); else products.push({ id: Date.now(), ...values }); showToast(id ? 'Producto actualizado.' : 'Producto agregado.', 'success'); } persist(); closeModal(); render(); } catch (error) { showToast(error instanceof Error ? error.message : 'Ocurrió un error inesperado.', 'error'); } }
function refreshInventoryFilters() {
  const search = document.querySelector<HTMLInputElement>('#inventory-search')?.value || ''
  const category = document.querySelector<HTMLSelectElement>('#inventory-category')?.value || 'Todas'
  const status = document.querySelector<HTMLSelectElement>('#inventory-status')?.value || 'Todos'
  const groups = document.querySelector<HTMLElement>('#inventory-groups')
  if (groups) groups.innerHTML = inventoryRows(search, category, status)
}

function exportCsv() {
  const { start, end } = getReportRange()
  const rows = ['Producto,Fecha,Cantidad,Total', ...filterSalesByRange(start, end).map((sale) => `${sale.productName},${sale.date},${sale.quantity},${sale.total}`)]
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }))
  link.download = 'reporte-ventas.csv'
  link.click()
}
let lastSalesCount = sales.length
let lastCloudSalesCount = sales.length
function showPayment(total: number) { document.querySelector('#modal-root')!.innerHTML = `<div class="modal-backdrop"><section class="payment-modal"><div class="payment-copy"><p class="eyebrow">VENTA REGISTRADA</p><h2>Listo para cobrar</h2><p class="subtle">Muestra este código QR al cliente para completar el pago.</p><div class="payment-total"><span>Total a pagar</span><strong>${money(total)}</strong></div><p class="payment-note">Confirma el pago antes de finalizar.</p><button class="primary full" type="button" data-action="close">Finalizar</button></div><div class="qr-panel"><div class="qr-frame"><img src="/codigo-qr.jpeg" alt="Código QR de pago BCP" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><div class="qr-missing" hidden>No se encontró el QR de pago.</div></div><strong>Pago por QR BCP</strong><small>Escanea para pagar</small></div></section></div>`; document.querySelector<HTMLElement>('[data-action="close"]')!.addEventListener('click', closeModal) }
function setupSaleDetails() { const form = document.querySelector<HTMLFormElement>('#modal-form[data-kind="sale"]'); if (!form || form.dataset.detailsReady) return; form.dataset.detailsReady = 'true'; const productSelect = form.querySelector<HTMLSelectElement>('#sale-product')!; const productLabel = productSelect.closest('label')!; const quantityLabel = form.querySelector<HTMLInputElement>('[name="quantity"]')!.closest('label')!; const priceLabel = document.createElement('label'); priceLabel.innerHTML = 'Precio unitario<input id="sale-price" type="text" readonly aria-readonly="true">'; productLabel.after(priceLabel); const updatePrice = () => { const product = products.find((item) => item.id === Number(productSelect.value)); const price = priceLabel.querySelector<HTMLInputElement>('input')!; price.value = product ? money(product.price) : ''; productSelect.querySelectorAll('option').forEach((option) => { const item = products.find((entry) => entry.id === Number(option.value)); if (item) option.textContent = item.name }) }; productSelect.addEventListener('change', updatePrice); updatePrice(); quantityLabel.querySelector('input')!.setAttribute('aria-label', 'Cantidad de unidades'); }
function setupSaleCart() { const form = document.querySelector<HTMLFormElement>('#modal-form[data-kind="sale"]'); if (!form || form.dataset.cartReady) return; form.dataset.cartReady = 'true'; const productSelect = form.querySelector<HTMLSelectElement>('#sale-product')!; const quantityInput = form.querySelector<HTMLInputElement>('[name="quantity"]')!; const actions = form.querySelector<HTMLElement>('.form-actions')!; const cart: { productId: number; quantity: number }[] = []; const cartBox = document.createElement('div'); cartBox.className = 'sale-cart'; cartBox.innerHTML = '<div class="cart-head"><strong>Productos de la venta</strong><span id="cart-count">0 productos</span></div><div id="cart-items" class="cart-items"></div><div class="cart-total"><span>Total a pagar</span><strong id="cart-total">$0.00</strong></div>'; const addButton = document.createElement('button'); addButton.className = 'outline add-product'; addButton.type = 'button'; addButton.textContent = '+ Agregar producto'; actions.before(addButton, cartBox); const renderCart = () => { const items = document.querySelector<HTMLElement>('#cart-items')!; const total = cart.reduce((sum, item) => { const product = products.find((entry) => entry.id === item.productId)!; return sum + product.price * item.quantity }, 0); items.innerHTML = cart.length ? cart.map((item) => { const product = products.find((entry) => entry.id === item.productId)!; return `<div class="cart-item"><div><strong>${product.name}</strong><small>${money(product.price)} × ${item.quantity}</small></div><b>${money(product.price * item.quantity)}</b><button type="button" data-remove-product="${product.id}" aria-label="Quitar producto">×</button></div>` }).join('') : '<p class="cart-empty">Agrega uno o más productos a la venta.</p>'; document.querySelector('#cart-count')!.textContent = `${cart.length} producto${cart.length === 1 ? '' : 's'}`; document.querySelector('#cart-total')!.textContent = money(total); document.querySelectorAll<HTMLElement>('[data-remove-product]').forEach((button) => button.addEventListener('click', () => { const index = cart.findIndex((item) => item.productId === Number(button.dataset.removeProduct)); if (index >= 0) cart.splice(index, 1); renderCart() })) }; addButton.addEventListener('click', () => { const product = products.find((entry) => entry.id === Number(productSelect.value)); const quantity = Number(quantityInput.value); if (!product || quantity < 1) return; const existing = cart.find((item) => item.productId === product.id); const nextQuantity = (existing?.quantity || 0) + quantity; if (nextQuantity > product.stock) return alert(`Solo hay ${product.stock} unidades disponibles.`); if (existing) existing.quantity = nextQuantity; else cart.push({ productId: product.id, quantity }); renderCart(); quantityInput.value = '1' }); form.addEventListener('submit', (event) => { if (!cart.length) return; event.preventDefault(); event.stopImmediatePropagation(); cart.forEach((item) => { const product = products.find((entry) => entry.id === item.productId)!; product.stock -= item.quantity; sales.push({ id: Date.now() + item.productId, productId: product.id, productName: product.name, quantity: item.quantity, total: product.price * item.quantity, date: new Date().toISOString().slice(0, 10) }) }); persist(); closeModal(); render() }, true); renderCart() }
const modalObserver = new MutationObserver(() => { setupSaleDetails(); setupSaleCart(); if (sales.length > lastSalesCount) { const total = sales.slice(lastSalesCount).reduce((sum, sale) => sum + sale.total, 0); lastSalesCount = sales.length; showPayment(total); syncNewSales() } });
document.addEventListener('submit', (event) => { const form = event.target as HTMLFormElement; if (form.id !== 'admin-auth-form' && form.dataset.kind !== 'sale' && form.dataset.kind !== 'stock') window.setTimeout(() => syncCloudWithFeedback(), 0) }, true);
document.addEventListener('input', (event) => {
  const target = event.target
  if (target instanceof HTMLInputElement && target.id === 'product-search') {
    const rows = document.querySelector<HTMLElement>('#product-rows')
    if (rows) rows.innerHTML = renderProductRows(target.value)
  }
  if (target instanceof HTMLInputElement && target.id === 'inventory-search') refreshInventoryFilters()
});
document.addEventListener('change', (event) => {
  const target = event.target
  if (target instanceof HTMLSelectElement && ['inventory-category', 'inventory-status'].includes(target.id)) refreshInventoryFilters()
});
document.addEventListener('click', (event) => {
  const target = event.target
  if (target instanceof Element && target.closest('[data-action="new-stock-movement"]')) showStockMovementModal()
});
document.addEventListener('input', (event) => {
  const target = event.target
  if (target instanceof HTMLInputElement && target.dataset.movementFilter) updateMovementFilter(target)
});
document.addEventListener('change', (event) => {
  const target = event.target
  if ((target instanceof HTMLInputElement || target instanceof HTMLSelectElement) && target.dataset.movementFilter) updateMovementFilter(target)
});
initializeAuth();
modalObserver.observe(document.body, { childList: true, subtree: true });
