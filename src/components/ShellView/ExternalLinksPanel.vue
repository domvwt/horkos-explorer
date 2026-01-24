<template>
  <div
    v-if="links.length > 0"
    class="external-links"
  >
    <h6>External Resources</h6>
    <div class="links-grid">
      <a
        v-for="link in links"
        :key="link.label"
        :href="link.url"
        target="_blank"
        rel="noopener noreferrer"
        class="btn btn-sm btn-outline-secondary external-link"
      >
        <i :class="link.icon" /> {{ link.label }}
      </a>
    </div>
  </div>
</template>

<script>
export default {
  name: "ExternalLinksPanel",
  props: {
    entityType: {
      type: String,
      required: true,
    },
    properties: {
      type: Array,
      required: true,
    },
  },
  computed: {
    links() {
      if (!this.entityType) {
        return [];
      }

      const links = [];

      // Get property value by name
      const getProperty = (name) => {
        const prop = this.properties.find(p => p.name === name);
        return prop ? prop.value : null;
      };

      const entityName = getProperty('name');

      // Common links for all entities
      if (entityName) {
        links.push({
          label: 'Google Search',
          url: `https://www.google.com/search?q=${encodeURIComponent(entityName)}`,
          icon: 'fa-brands fa-google'
        });
        links.push({
          label: 'Wikipedia',
          url: `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(entityName)}`,
          icon: 'fa-brands fa-wikipedia-w'
        });
      }

      // Entity-specific links
      if (this.entityType === 'Company') {
        const companyNumber = getProperty('company_number');
        const jurisdiction = getProperty('jurisdiction');

        if (companyNumber && jurisdiction === 'GB') {
          links.push({
            label: 'Companies House',
            url: `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(companyNumber)}`,
            icon: 'fa-solid fa-building'
          });
        }

        if (entityName) {
          links.push({
            label: 'OpenCorporates',
            url: `https://opencorporates.com/companies?q=${encodeURIComponent(entityName)}`,
            icon: 'fa-solid fa-briefcase'
          });
          links.push({
            label: 'Google News',
            url: `https://news.google.com/search?q=${encodeURIComponent(entityName)}`,
            icon: 'fa-solid fa-newspaper'
          });
        }
      } else if (this.entityType === 'Person') {
        if (entityName) {
          links.push({
            label: 'Google News',
            url: `https://news.google.com/search?q=${encodeURIComponent(entityName)}`,
            icon: 'fa-solid fa-newspaper'
          });
        }
      } else if (this.entityType === 'Address') {
        const fullAddress = getProperty('full');
        const postCode = getProperty('post_code');

        const addressQuery = fullAddress || postCode;
        if (addressQuery) {
          links.push({
            label: 'Google Maps',
            url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressQuery)}`,
            icon: 'fa-solid fa-map-marked-alt'
          });
        }
      }

      return links;
    }
  }
};
</script>

<style lang="scss" scoped>
.external-links {
  margin-top: 1rem;

  h6 {
    font-size: 0.9rem;
    font-weight: 600;
    margin-bottom: 0.75rem;
    color: var(--bs-body-text);
  }

  .links-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  .external-link {
    padding: 0.4rem 0.6rem;
    font-size: 0.85rem;
    text-align: center;
    background-color: var(--bs-body-bg);
    color: var(--bs-body-text);
    border-color: var(--bs-body-inactive);
    border-radius: 0.375rem;
    text-decoration: none;
    transition: all 0.2s;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;

    &:hover {
      background-color: var(--bs-body-bg-hover);
      border-color: var(--bs-body-text);
      transform: translateY(-1px);
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }

    i {
      margin-right: 0.25rem;
    }
  }
}
</style>
