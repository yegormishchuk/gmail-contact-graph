// Search functionality module
import * as state from './state.js';
import { escapeHtml, filterData, getNodeRadius } from './utils.js';
import { renderGraph } from './render.js';

const searchInput = document.getElementById('contact-search');
const searchResults = document.getElementById('search-results');
let selectedIndex = -1;

export function searchContacts(query) {
    if (!state.rawData || !query.trim()) return [];

    const lowerQuery = query.toLowerCase().trim();

    // Search in all contacts (not just displayed ones)
    return state.rawData.nodes
        .filter(node => !node.isCenter)
        .filter(node => {
            const name = (node.name || '').toLowerCase();
            const email = (node.email || '').toLowerCase();
            return name.includes(lowerQuery) || email.includes(lowerQuery);
        })
        .sort((a, b) => {
            // Prioritize matches at the start
            const aName = (a.name || '').toLowerCase();
            const bName = (b.name || '').toLowerCase();
            const aEmail = (a.email || '').toLowerCase();
            const bEmail = (b.email || '').toLowerCase();

            const aStartsName = aName.startsWith(lowerQuery);
            const bStartsName = bName.startsWith(lowerQuery);
            const aStartsEmail = aEmail.startsWith(lowerQuery);
            const bStartsEmail = bEmail.startsWith(lowerQuery);

            if ((aStartsName || aStartsEmail) && !(bStartsName || bStartsEmail)) return -1;
            if (!(aStartsName || aStartsEmail) && (bStartsName || bStartsEmail)) return 1;

            // Then by composite score
            return (b.compositeScore || 0) - (a.compositeScore || 0);
        })
        .slice(0, 10);
}

export function renderSearchResults(results) {
    selectedIndex = -1;

    if (results.length === 0) {
        searchResults.innerHTML = '<div class="search-no-results">No results found</div>';
        searchResults.classList.add('visible');
        return;
    }

    searchResults.innerHTML = results.map((contact, index) => `
        <div class="search-result-item" data-index="${index}" data-email="${contact.email}">
            <div class="search-result-name">${escapeHtml(contact.name)}</div>
            <div class="search-result-email">${escapeHtml(contact.email)}</div>
            <div class="search-result-stats">
                <span class="received">↓${contact.received}</span>
                <span class="sent">↑${contact.sent}</span>
            </div>
        </div>
    `).join('');

    searchResults.classList.add('visible');
}

export function selectContact(email) {
    // Find contact in raw data
    const contact = state.rawData.nodes.find(n => n.email === email && !n.isCenter);
    if (!contact) return;

    // Check if contact is currently displayed
    const displayedNode = state.currentNodes?.find(n => n.email === email);

    if (displayedNode) {
        // Node is displayed - focus on it
        focusOnNode(displayedNode);
    } else {
        // Node is not in current filter - add it temporarily by increasing limit
        // and re-filtering to include this contact
        focusOnContactByEmail(email);
    }

    // Clear search
    searchInput.value = '';
    searchResults.classList.remove('visible');
}

function focusOnNode(node) {
    if (!state.currentSvg || !state.currentZoom) return;

    const container = document.getElementById('graph-container');
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Calculate transform to center the node
    const scale = 1.5;
    const x = width / 2 - node.x * scale;
    const y = height / 2 - node.y * scale;

    const transform = d3.zoomIdentity.translate(x, y).scale(scale);

    state.currentSvg.transition()
        .duration(500)
        .call(state.currentZoom.transform, transform)
        .on('end', () => {
            // Simulate hover on the node
            simulateNodeHover(node);
        });
}

function focusOnContactByEmail(email) {
    // Temporarily increase limit to ensure contact is visible
    const contact = state.rawData.nodes.find(n => n.email === email && !n.isCenter);
    if (!contact) return;

    // Calculate what limit we need
    const allContacts = state.rawData.nodes.filter(n => !n.isCenter);
    allContacts.sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0));

    const contactIndex = allContacts.findIndex(c => c.email === email);
    const neededLimit = contactIndex + 1;

    // Update limit if needed
    if (neededLimit > state.filters.limit) {
        state.filters.limit = Math.min(neededLimit, state.rawData.stats.totalContacts);
        document.getElementById('contact-limit').value = state.filters.limit;
        document.getElementById('limit-value').textContent = state.filters.limit;
    }

    // Apply filters and then focus
    const filteredData = filterData(state.rawData);
    renderGraph(filteredData);

    // Wait for simulation to settle a bit, then focus
    setTimeout(() => {
        const node = state.currentNodes?.find(n => n.email === email);
        if (node) {
            focusOnNode(node);
        }
    }, 300);
}

function simulateNodeHover(node) {
    // Find the node element and trigger mouseover
    const nodeElements = d3.selectAll('.node-contact');
    nodeElements.each(function(d) {
        if (d.email === node.email) {
            const event = new MouseEvent('mouseover', {
                bubbles: true,
                clientX: window.innerWidth / 2,
                clientY: window.innerHeight / 2
            });
            this.dispatchEvent(event);
        }
    });
}

function updateSelectedItem(items) {
    items.forEach((item, index) => {
        item.classList.toggle('selected', index === selectedIndex);
    });

    // Scroll into view
    if (items[selectedIndex]) {
        items[selectedIndex].scrollIntoView({ block: 'nearest' });
    }
}

// Initialize search event listeners
export function initSearchListeners() {
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value;

        if (!query.trim()) {
            searchResults.classList.remove('visible');
            return;
        }

        const results = searchContacts(query);
        renderSearchResults(results);

        // Auto-select if only one result
        if (results.length === 1) {
            selectContact(results[0].email);
        }
    });

    searchInput.addEventListener('keydown', (e) => {
        const items = searchResults.querySelectorAll('.search-result-item');

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
            updateSelectedItem(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, 0);
            updateSelectedItem(items);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (selectedIndex >= 0 && items[selectedIndex]) {
                const email = items[selectedIndex].dataset.email;
                selectContact(email);
            } else {
                // Select first result
                const results = searchContacts(searchInput.value);
                if (results.length > 0) {
                    selectContact(results[0].email);
                }
            }
        } else if (e.key === 'Escape') {
            searchResults.classList.remove('visible');
            searchInput.blur();
        }
    });

    // Click on search result
    searchResults.addEventListener('click', (e) => {
        const item = e.target.closest('.search-result-item');
        if (item) {
            selectContact(item.dataset.email);
        }
    });

    // Close search results when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-group')) {
            searchResults.classList.remove('visible');
        }
    });
}
