/**
 * Kelas Aplikasi WebGIS
 * Diperbarui dengan manajemen Penanda (Marker) tingkat lanjut
 */
class WebGIS {
    constructor() {
        this.map = null; // Objek peta Leaflet
        this.activeWmsLayers = []; // Daftar layer WMS yang sedang aktif
        this.baseLayers = {}; // Objek untuk menyimpan peta dasar
        this.isSelectMode = true; // Status mode (Select vs Pan)
        this.currentCRS = 'EPSG:3857'; // Sistem koordinat aktif
        this.markerGroup = null; // Container untuk semua penanda di peta
        this.highlightLayer = null; // Layer untuk highlight fitur yang dipilih
        this.markers = []; // Array untuk melacak data penanda individu

        this.initEventListeners(); // Inisialisasi tombol dan kontrol UI
        this.reloadProject(false); // Muat proyek lokal sebagai default awal
    }

    initEventListeners() {
        const projectToggle = document.getElementById('project-toggle');
        const modeText = document.getElementById('current-mode-text');

        // Note to self : JANGAN UBAH INI ATAUPUN DISENTUH, SISTEM ERROR MULU
        // KALAU GA PAKAI INI 
        //  Handler untuk switch Proyek Lokal vs Global
        if (projectToggle) {
            projectToggle.onchange = (e) => {
                const isOnline = e.target.checked;
                modeText.innerText = isOnline ? "Proyek Global (4326)" : "Proyek Lokal (3857)";
                this.reloadProject(isOnline);
            };
        }

        // Kontrol untuk membuka/tutup sidebar
        const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
        const sidebar = document.getElementById('sidebar');
        if (toggleSidebarBtn) toggleSidebarBtn.onclick = () => sidebar.classList.toggle('minimized');

        // Modal Pengaturan
        const settingsBtn = document.getElementById('settings-btn');
        const settingsModal = document.getElementById('settings-modal');
        const closeSettingsBtn = document.getElementById('close-settings');
        if (settingsBtn) settingsBtn.onclick = () => settingsModal.classList.add('active');
        if (closeSettingsBtn) closeSettingsBtn.onclick = () => settingsModal.classList.remove('active');

        const aboutBtn = document.getElementById('about-btn');
        const aboutModal = document.getElementById('about-modal');
        const closeAboutBtn = document.getElementById('close-about');
        if (aboutBtn) aboutBtn.onclick = () => aboutModal.classList.add('active');
        if (closeAboutBtn) closeAboutBtn.onclick = () => aboutModal.classList.remove('active');


        // Modal Hubungkan GeoServer
        const connectionBtn = document.getElementById('connect-new-layer');
        const gsModal = document.getElementById('geoserver-modal');
        const cancelModal = document.getElementById('cancel-modal');
        const connectGsBtn = document.getElementById('connect-gs');

        if (connectionBtn) connectionBtn.onclick = () => gsModal.classList.add('active');
        if (cancelModal) cancelModal.onclick = () => gsModal.classList.remove('active');

        if (connectGsBtn) {
            connectGsBtn.onclick = async () => {
                const url = document.getElementById('gs-url').value;
                const layer = document.getElementById('gs-layer').value;
                if (url && layer) {
                    const originalText = connectGsBtn.innerText;
                    connectGsBtn.innerText = 'Menghubungkan...';
                    connectGsBtn.disabled = true;
                    await this.addWmsLayer(url, layer);
                    connectGsBtn.innerText = originalText;
                    connectGsBtn.disabled = false;
                    gsModal.classList.remove('active');
                }
            };
        }

        const panTool = document.getElementById('pan-tool');
        const selectTool = document.getElementById('select-tool');
        const mapDiv = document.getElementById('map');

        // Toggle Tool: Pan vs Select (Identifikasi)
        panTool.onclick = () => {
            this.isSelectMode = false;
            panTool.classList.add('active');
            selectTool.classList.remove('active');
            mapDiv.classList.remove('select-active');
            mapDiv.classList.add('pan-active');
        };

        selectTool.onclick = () => {
            this.isSelectMode = true;
            selectTool.classList.add('active');
            panTool.classList.remove('active');
            mapDiv.classList.remove('pan-active');
            mapDiv.classList.add('select-active');
        };

        // Set state awal
        mapDiv.classList.add('pan-active');

        // Efek kursor saat dragging
        this.map.on('mousedown', () => mapDiv.classList.add('grabbing'));
        this.map.on('mouseup', () => mapDiv.classList.remove('grabbing'));

        const opacityInput = document.getElementById('global-opacity');
        const opacityVal = document.getElementById('opacity-val');
        if (opacityInput) {
            opacityInput.oninput = (e) => {
                const val = e.target.value;
                opacityVal.innerText = val + '%';
                this.activeWmsLayers.forEach(l => l.layer.setOpacity(val / 100));
            };
        }

        const themeSelect = document.getElementById('map-theme');
        if (themeSelect) {
            themeSelect.onchange = (e) => {
                if (e.target.value === 'dark') mapDiv.classList.add('dark-theme');
                else mapDiv.classList.remove('dark-theme');
            };
        }

        const disconnectToggle = document.getElementById('force-disconnect');
        if (disconnectToggle) {
            disconnectToggle.onchange = () => {
                alert("Mode Eksperimental: Status akan berubah pada pemuatan/perpindahan layer berikutnya.");
                this.reloadProject(document.getElementById('project-toggle').checked);
            };
        }

        // Pencari Lokasi Saya
        const locateBtn = document.getElementById('locate-btn');
        if (locateBtn) {
            locateBtn.onclick = () => {
                if (!navigator.geolocation) {
                    alert("Browser Anda tidak mendukung pencarian lokasi.");
                    return;
                }

                locateBtn.style.opacity = "0.5";
                navigator.geolocation.getCurrentPosition(
                    (pos) => {
                        const { latitude, longitude } = pos.coords;
                        this.map.setView([latitude, longitude], 16);

                        const pulseIcon = L.divIcon({
                            className: 'location-pulse-icon',
                            html: '<div class="pulse-dot"></div><div class="pulse-ring"></div>',
                            iconSize: [20, 20]
                        });

                        L.marker([latitude, longitude], { icon: pulseIcon }).addTo(this.map)
                            .bindPopup("<b>Lokasi Anda</b>").openPopup();

                        locateBtn.style.opacity = "1";
                    },
                    () => {
                        alert("Gagal mendapatkan lokasi. Pastikan izin telah diberikan.");
                        locateBtn.style.opacity = "1";
                    }
                );
            };
        }
    }

    /**
     * NOTE TO SELF : INI JUGA JANGAN DIUBAH YA ALLAH!
     * Memuat ulang peta berdasarkan proyek yang dipilih
     * @param {boolean} isOnline - true untuk Global (4326), false untuk Lokal (3857)
     */
    reloadProject(isOnline) {
        if (this.map) {
            this.map.remove(); // Hapus instance peta lama
            this.map = null;
        }

        const baseList = document.getElementById('base-maps-list');
        const layerList = document.getElementById('operational-layers-list');
        const markerList = document.getElementById('placed-markers-list');

        if (baseList) baseList.innerHTML = '';
        if (layerList) layerList.innerHTML = '';
        if (markerList) markerList.innerHTML = '';

        this.activeWmsLayers = [];
        this.markers = []; // Reset array penanda saat memuat ulang proyek

        // Penentuan CRS dan Lokasi Awal
        this.currentCRS = isOnline ? 'EPSG:4326' : 'EPSG:3857';
        const center = isOnline ? [-0.7399, 100.8] : [-7.3274, 108.2201];
        const zoom = isOnline ? 8 : 12;

        this.map = L.map('map', {
            crs: isOnline ? L.CRS.EPSG4326 : L.CRS.EPSG3857,
            zoomControl: false,
            attributionControl: false
        }).setView(center, zoom);

        L.control.zoom({ position: 'bottomleft' }).addTo(this.map);

        // Buat pane khusus untuk kontrol urutan tampilan (Z-Index)
        this.map.createPane('geoserver-pane');
        this.map.getPane('geoserver-pane').style.zIndex = 400;

        this.map.createPane('highlight-pane');
        this.map.getPane('highlight-pane').style.zIndex = 600;
        this.map.getPane('highlight-pane').style.pointerEvents = 'none';

        this.markerGroup = L.layerGroup().addTo(this.map);
        this.highlightLayer = L.geoJSON(null, {
            pane: 'highlight-pane',
            style: { color: '#ff0000', weight: 4, fillColor: '#ff0000', fillOpacity: 0.4 }
        }).addTo(this.map);

        if (isOnline) {
            this.baseLayers = {
                "Peta OSM (WMS)": L.tileLayer.wms('https://ows.mundialis.de/services/service?', { layers: 'OSM-WMS' }),
                "Satelit NASA (WMS)": L.tileLayer.wms('https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi', {
                    layers: 'BlueMarble_NextGeneration',
                    format: 'image/jpeg',
                    attribution: '&copy; NASA GIBS'
                })
            };
        } else {
            this.baseLayers = {
                "OpenStreetMap": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'),
                "Satelit ESRI": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}')
            };
        }

        const first = Object.keys(this.baseLayers)[0];
        this.baseLayers[first].addTo(this.map);

        Object.keys(this.baseLayers).forEach(name => {
            const item = document.createElement('div');
            item.className = name === first ? 'layer-item active' : 'layer-item';
            item.innerHTML = `<span>${name}</span><div class="layer-toggle"></div>`;
            item.onclick = () => {
                Object.keys(this.baseLayers).forEach(k => this.map.removeLayer(this.baseLayers[k]));
                document.querySelectorAll('#base-maps-list .layer-item').forEach(el => el.classList.remove('active'));
                this.baseLayers[name].addTo(this.map);
                item.classList.add('active');
            };
            baseList.appendChild(item);
        });

        if (isOnline) {
            this.addWmsLayer('https://geoportal.sumbarprov.go.id/geoserver/wms', 'geonode:1300_250_ar_peta_administrasi_sumatera_barat_2025e2b1e1c7578f', 'Peta Administrasi Sumbar');
        } else {
            this.addWmsLayer('http://localhost:8080/geoserver/wms', 'wilduntasik:Kecamatan.Kota.Tasikmalaya', 'Kecamatan Kota Tasikmalaya');
        }

        this.setupMapInteractions();
    }

    /**
     * Menambahkan Layer WMS dari GeoServer ke Peta
     * Fungsi ini melakukan pengecekan koneksi sebelum menambahkan layer
     */
    async addWmsLayer(url, layerName, displayName = null) {
        const isForcedDisconnect = document.getElementById('force-disconnect')?.checked;
        const display = displayName || this.formatLayerName(layerName);
        const isOnlineLayer = url.includes('http') && !url.includes('localhost');

        const showError = (targetUrl) => {
            const errorModal = document.getElementById('error-modal');
            const errorUrlText = document.getElementById('error-url');
            if (errorModal) {
                errorUrlText.innerText = targetUrl;
                errorModal.classList.add('active');
                document.getElementById('error-ok').onclick = () => errorModal.classList.remove('active');
                document.getElementById('close-error').onclick = () => errorModal.classList.remove('active');
            }
            const errorItem = document.createElement('div');
            errorItem.className = 'layer-item';
            errorItem.style.borderColor = '#ef4444';
            errorItem.innerHTML = `<span style="color:#ef4444;">[ERR] ${display}</span><div style="font-size:0.7rem; color:#ef4444;">TERPUTUS</div>`;
            document.getElementById('operational-layers-list').appendChild(errorItem);
        };

        if (isForcedDisconnect) return showError(url);

        // Pengecekan koneksi menggunakan fetch (Cek apakah server hidup)
        // Kita lewati pengecekan untuk layer online (https) karena sering terkendala CORS/Mixed Content
        if (!isOnlineLayer) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);
                await fetch(url, { method: 'GET', mode: 'no-cors', signal: controller.signal });
                clearTimeout(timeoutId);
            } catch (e) { return showError(url); }
        }

        // Konfigurasi Layer WMS Leaflet
        const wmsLayer = L.tileLayer.wms(url, {
            layers: layerName,
            format: 'image/png',
            transparent: true,
            version: '1.1.1',
            tiled: !isOnlineLayer,
            pane: 'geoserver-pane'
        }).addTo(this.map);

        this.activeWmsLayers.push({ layer: wmsLayer, name: layerName, url: url });

        const item = document.createElement('div');
        item.className = 'layer-item active';
        item.innerHTML = `<span>${display}</span><div class="layer-toggle"></div>`;
        item.onclick = () => {
            if (this.map.hasLayer(wmsLayer)) {
                this.map.removeLayer(wmsLayer);
                item.classList.remove('active');
            } else {
                wmsLayer.addTo(this.map);
                item.classList.add('active');
            }
        };
        document.getElementById('operational-layers-list').appendChild(item);
    }

    setupMapInteractions() {
        this.map.on('click', (e) => {
            const isForcedDisconnect = document.getElementById('force-disconnect')?.checked;
            const activeMarkerBtn = document.querySelector('.marker-btn.active');
            
            if (activeMarkerBtn) {
                this.createNewMarker(e.latlng, activeMarkerBtn.dataset.color);
                return;
            }

            if (!this.isSelectMode) return;
            const infoBox = document.getElementById('feature-info-box');
            const info = document.getElementById('info-content');

            if (infoBox) infoBox.style.display = 'block';
            if (info) info.innerHTML = '<div class="placeholder-text">Memuat data...</div>';

            // Cek jika mode paksa error aktif
            if (isForcedDisconnect) {
                setTimeout(() => {
                    if (info) info.innerHTML = '<div style="color:#ef4444; padding:1rem; text-align:center;"><b>Gagal Memuat (Paksa)</b><br><span style="font-size:0.8rem;">Eksperimen Tutup Paksa sedang aktif.</span></div>';
                }, 400);
                return;
            }

            const layers = this.activeWmsLayers.filter(l => this.map.hasLayer(l.layer));
            if (layers.length === 0) {
                if (info) info.innerHTML = '<div class="placeholder-text">Klik layer untuk mengaktifkan identifikasi.</div>';
                return;
            }
            const target = layers[layers.length - 1];
            const size = this.map.getSize();
            const bounds = this.map.getBounds();
            let bbox = this.currentCRS === 'EPSG:3857' ?
                [this.map.options.crs.project(bounds.getSouthWest()).x, this.map.options.crs.project(bounds.getSouthWest()).y, this.map.options.crs.project(bounds.getNorthEast()).x, this.map.options.crs.project(bounds.getNorthEast()).y].join(',') :
                bounds.toBBoxString();

            const params = {
                request: 'GetFeatureInfo', service: 'WMS', srs: this.currentCRS, version: '1.1.1',
                bbox: bbox, height: size.y, width: size.x, layers: target.name, query_layers: target.name,
                x: Math.round(this.map.latLngToContainerPoint(e.latlng).x), y: Math.round(this.map.latLngToContainerPoint(e.latlng).y),
                info_format: target.url.includes('localhost') ? 'application/json' : 'text/javascript'
            };
            if (!target.url.includes('localhost')) params.format_options = 'callback:handleFeatureInfo';
            const url = target.url + L.Util.getParamString(params, target.url, true);
            if (target.url.includes('http') && !target.url.includes('localhost')) {
                window.handleFeatureInfo = (data) => this.renderData(data);
                const s = document.createElement('script');
                s.src = url;
                document.body.appendChild(s);
                s.onload = () => s.remove();
                s.onerror = () => {
                    info.innerHTML = '<div style="color:#ef4444; padding:1rem; text-align:center;"><b>Gagal Memuat</b><br><span style="font-size:0.8rem;">Server tidak merespons atau Anda sedang offline.</span></div>';
                };
            } else {
                fetch(url)
                    .then(r => r.json())
                    .then(data => this.renderData(data))
                    .catch(() => {
                        info.innerHTML = '<div style="color:#ef4444; padding:1rem; text-align:center;"><b>Koneksi Terputus</b><br><span style="font-size:0.8rem;">Tidak dapat mengambil data dari GeoServer Lokal.</span></div>';
                    });
            }
        });

        const markerBtns = document.querySelectorAll('.marker-btn');
        markerBtns.forEach(btn => {
            btn.onclick = () => {
                const wasActive = btn.classList.contains('active');
                markerBtns.forEach(b => b.classList.remove('active'));
                if (!wasActive) btn.classList.add('active');
            };
        });

        const clear = document.getElementById('clear-markers');
        if (clear) clear.onclick = () => {
            this.markerGroup.clearLayers();
            this.markers = [];
            this.refreshMarkerList();
        };
    }

    /**
     * FITUR PENANDA LANJUTAN
     */
    createNewMarker(latlng, color) {
        const id = Date.now();
        const defaultName = `Lokasi Baru #${this.markers.length + 1}`;

        const svg = `<svg width="28" height="28" viewBox="0 0 24 24" fill="${color}" stroke="black" stroke-width="1.5"><path d="M12 21l-8.2-11.9c-1.1-1.6-1.8-3.4-1.8-5.3 0-5.4 4.4-9.8 9.8-9.8s9.8 4.4 9.8 9.8c0 1.9-.7 3.7-1.8 5.3l-8.2 11.9z"/></svg>`;
        const icon = L.divIcon({ html: svg, className: 'c-mark', iconSize: [28, 28], iconAnchor: [14, 28] });

        const marker = L.marker(latlng, { icon }).addTo(this.markerGroup);

        // Popup dengan fitur Ubah Nama
        const popupContent = document.createElement('div');
        popupContent.innerHTML = `
            <div style="font-weight:600; margin-bottom:4px; display:flex; justify-content:space-between; align-items:center;">
                Detail Penanda
                <button class="marker-del-btn-popup" id="del-pop-${id}" title="Hapus Penanda">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </div>
            <input type="text" value="${defaultName}" class="popup-input" id="input-${id}">
            <div style="font-size:0.7rem; color:#94a3b8; margin-top:0.5rem;">${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}</div>
        `;

        marker.bindPopup(popupContent).openPopup();

        // Pelacakan Objek Penanda
        const markerObj = { id, marker, name: defaultName, color, latlng };
        this.markers.push(markerObj);
        this.refreshMarkerList();

        // Penanganan Event untuk Elemen Popup
        setTimeout(() => {
            const input = document.getElementById(`input-${id}`);
            const delBtn = document.getElementById(`del-pop-${id}`);
            if (input) {
                input.oninput = (e) => {
                    markerObj.name = e.target.value;
                    this.refreshMarkerList();
                };
            }
            if (delBtn) {
                delBtn.onclick = () => this.deleteMarker(id);
            }
        }, 100);
    }

    refreshMarkerList() {
        const container = document.getElementById('placed-markers-list');
        if (!container) return;
        container.innerHTML = '';

        this.markers.forEach(m => {
            const item = document.createElement('div');
            item.className = 'marker-entry';
            item.innerHTML = `
                <div class="marker-color-dot" style="background:${m.color}"></div>
                <div class="marker-name">${m.name}</div>
                <button class="marker-del-btn" title="Hapus">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            `;

            item.onclick = (e) => {
                if (e.target.closest('.marker-del-btn')) {
                    this.deleteMarker(m.id);
                } else {
                    this.map.panTo(m.latlng);
                    m.marker.openPopup();
                }
            };
            container.appendChild(item);
        });
    }

    deleteMarker(id) {
        const idx = this.markers.findIndex(m => m.id === id);
        if (idx > -1) {
            this.markerGroup.removeLayer(this.markers[idx].marker);
            this.markers.splice(idx, 1);
            this.refreshMarkerList();
        }
    }

    /**
     * Memproses dan menampilkan data atribut hasil klik identifikasi
     * @param {object} data - GeoJSON result dari GetFeatureInfo
     */
    renderData(data) {
        const info = document.getElementById('info-content');
        this.highlightLayer.clearLayers(); // Bersihkan highlight sebelumnya

        if (data.features && data.features.length > 0) {
            // Gambarkan highlight poligon/garis yang diklik
            if (data.features[0].geometry) {
                const highlightOptions = {};
                if (this.currentCRS === 'EPSG:3857') highlightOptions.coordsToLatLng = (c) => this.map.options.crs.unproject(L.point(c[0], c[1]));
                L.geoJSON(data.features[0], { pane: 'highlight-pane', style: { color: '#ff0000', weight: 4, fillColor: '#ff0000', fillOpacity: 0.4 }, ...highlightOptions }).addTo(this.highlightLayer);
            }

            // Loop data atribut dan tampilkan di sidebar/overlay
            const p = data.features[0].properties;
            let h = '<div class="info-list">';
            for (const k in p) {
                const val = p[k];
                // Abaikan kolom yang kosong atau bernilai nol yang tidak relevan
                if (val === null || val === undefined || String(val).trim() === '' || String(val) === '0') continue;

                // Rapikan nama kolom (snake_case ke Title Case)
                let label = k.replace(/_/g, ' ').toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                if (k === 'NAMOBJ') label = 'Nama'; else if (k === 'REMARK') label = 'Keterangan';

                h += `<div class="info-row"><span class="attr-label">${label}</span><span class="attr-value">${val}</span></div>`;
            }
            info.innerHTML = h + '</div>';
        } else {
            info.innerHTML = '<div class="placeholder-text">Fitur tidak ditemukan di lokasi ini.</div>';
        }
    }

    formatLayerName(name) {
        let clean = name.split(':').pop().replace(/[._]/g, ' ').replace(/[a-f0-9]{16,}$/i, '');
        return clean.split(' ').filter(w => w.length > 0).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ').trim();
    }
}

document.addEventListener('DOMContentLoaded', () => { window.app = new WebGIS(); });
