// Event listeners for filters
import { filters } from './state.js';

// Initialize filter listeners with a callback for applying filters
export function initFilterListeners(applyFilters) {
    document.getElementById('show-senders').addEventListener('change', (e) => {
        filters.showSenders = e.target.checked;
        applyFilters();
    });

    document.getElementById('show-recipients').addEventListener('change', (e) => {
        filters.showRecipients = e.target.checked;
        applyFilters();
    });

    document.getElementById('contact-limit').addEventListener('input', (e) => {
        filters.limit = parseInt(e.target.value);
        document.getElementById('limit-value').textContent = filters.limit;
        applyFilters();
    });
}
