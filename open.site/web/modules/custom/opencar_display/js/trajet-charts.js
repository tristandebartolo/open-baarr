/**
 * @file
 * Graphiques d'un trajet (vitesse, altitude, fréquence cardiaque).
 *
 * Config par node dans drupalSettings.opencarDisplay.charts[id] :
 * { series: { speed?, altitude?, heartRate? } } — paires {x, y}, x en
 * secondes depuis le départ, downsamplées côté serveur (~200 points).
 *
 * Le rendu suit le thème (dark/light) : couleurs texte/grille lues dans les
 * CSS custom properties du thème, re-rendu sur bascule prefers-color-scheme.
 */
(function (Drupal, once, drupalSettings) {
  'use strict';

  var SERIES_COLORS = {
    speed: '#208AEF',
    altitude: '#7A5AF8',
    heartRate: '#D64545'
  };

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var darkScheme = window.matchMedia('(prefers-color-scheme: dark)');
  var charts = [];

  function themeColors(element) {
    var style = window.getComputedStyle(element);
    return {
      text: style.getPropertyValue('--oc-text-secondary').trim() || '#60646C',
      grid: style.getPropertyValue('--oc-border').trim() || 'rgba(96, 100, 108, 0.15)'
    };
  }

  function formatTime(seconds) {
    var m = Math.floor(seconds / 60);
    var s = Math.round(seconds % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  function buildChart(canvas, key, data) {
    var color = SERIES_COLORS[key] || SERIES_COLORS.speed;
    var colors = themeColors(canvas);
    var gradient = null;

    var chart = new window.Chart(canvas, {
      type: 'line',
      data: {
        datasets: [{
          data: data,
          borderColor: color,
          borderWidth: 2,
          pointRadius: 0,
          pointHitRadius: 12,
          tension: 0.35,
          fill: true,
          backgroundColor: function (chartContext) {
            var chartArea = chartContext.chart.chartArea;
            if (!chartArea) {
              return 'transparent';
            }
            if (!gradient || gradient.height !== chartArea.height) {
              var ctx = chartContext.chart.ctx;
              var fill = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
              fill.addColorStop(0, color + '33');
              fill.addColorStop(1, color + '00');
              gradient = { fill: fill, height: chartArea.height };
            }
            return gradient.fill;
          }
        }]
      },
      options: {
        parsing: false,
        normalized: true,
        animation: reducedMotion.matches ? false : { duration: 400 },
        maintainAspectRatio: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: {
              title: function (items) {
                return items.length ? formatTime(items[0].parsed.x) : '';
              }
            }
          }
        },
        scales: {
          x: {
            type: 'linear',
            grid: { display: false },
            ticks: {
              color: colors.text,
              maxTicksLimit: 6,
              callback: function (value) {
                return formatTime(value);
              }
            }
          },
          y: {
            grid: { color: colors.grid },
            ticks: { color: colors.text, maxTicksLimit: 5 }
          }
        }
      }
    });
    charts.push({ chart: chart, canvas: canvas });
    return chart;
  }

  function refreshChartsTheme() {
    charts.forEach(function (entry) {
      var colors = themeColors(entry.canvas);
      entry.chart.options.scales.x.ticks.color = colors.text;
      entry.chart.options.scales.y.ticks.color = colors.text;
      entry.chart.options.scales.y.grid.color = colors.grid;
      entry.chart.update('none');
    });
  }

  darkScheme.addEventListener('change', refreshChartsTheme);
  // Bascule manuelle via le bouton dark/light du thème.
  window.addEventListener('oc-theme-change', refreshChartsTheme);

  Drupal.behaviors.opencarTrajetCharts = {
    attach: function (context) {
      once('opencar-trajet-chart', 'canvas[data-opencar-chart]', context).forEach(function (canvas) {
        var settings = (drupalSettings.opencarDisplay || {}).charts || {};
        var config = settings[canvas.getAttribute('data-opencar-node')];
        var key = canvas.getAttribute('data-opencar-chart');
        var data = config && config.series ? config.series[key] : null;
        if (data && data.length > 1 && window.Chart) {
          buildChart(canvas, key, data);
        }
      });
    }
  };
})(Drupal, once, drupalSettings);
