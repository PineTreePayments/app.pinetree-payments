/* global pinetreeWC, jQuery */
/**
 * PineTree Payments — admin JS.
 *
 * Loaded on WooCommerce settings page (PineTree tab) and WC order edit pages.
 * Provides: connection test, webhook URL copy, and generic data-pinetree-copy handler.
 */
jQuery(function ($) {

    // -------------------------------------------------------------------------
    // Generic copy handler — [data-pinetree-copy="<value>"] buttons
    // -------------------------------------------------------------------------

    function copyText(text, $btn) {
        var origText = $btn.text();
        var label    = (pinetreeWC && pinetreeWC.copiedLabel) ? pinetreeWC.copiedLabel : 'Copied!';

        function flashCopied() {
            $btn.text(label).prop('disabled', true);
            setTimeout(function () {
                $btn.text(origText).prop('disabled', false);
            }, 2000);
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(flashCopied).catch(flashCopied);
        } else {
            var $tmp = $('<textarea>')
                .val(text)
                .css({ position: 'fixed', opacity: 0 })
                .appendTo('body');
            $tmp[0].select();
            try { document.execCommand('copy'); flashCopied(); } catch (e) {}
            $tmp.remove();
        }
    }

    $(document).on('click', '[data-pinetree-copy]', function () {
        var value = $(this).data('pinetree-copy');
        if (value) {
            copyText(String(value), $(this));
        }
    });

    // -------------------------------------------------------------------------
    // Connection test — settings page only
    // -------------------------------------------------------------------------

    var $testBtn    = $('#pinetree-test-connection');
    var $testStatus = $('#pinetree-connection-status');

    if ($testBtn.length > 0 && pinetreeWC && pinetreeWC.ajaxUrl) {
        $testBtn.on('click', function () {
            $testBtn.prop('disabled', true);
            $testStatus
                .text(pinetreeWC.testingLabel)
                .css({ color: '#666', fontStyle: 'italic' });

            $.post(pinetreeWC.ajaxUrl, {
                action: 'pinetree_wc_test_connection',
                nonce:  pinetreeWC.nonce
            })
            .done(function (response) {
                $testBtn.prop('disabled', false);
                if (response.success) {
                    $testStatus
                        .text('✓ ' + response.data.message)
                        .css({ color: '#46b450', fontStyle: 'normal' });
                } else {
                    var msg = (response.data && response.data.message) ? response.data.message : 'Unknown error.';
                    $testStatus
                        .text('✗ ' + msg)
                        .css({ color: '#dc3232', fontStyle: 'normal' });
                }
            })
            .fail(function () {
                $testBtn.prop('disabled', false);
                $testStatus
                    .text('✗ Request failed — check network.')
                    .css({ color: '#dc3232', fontStyle: 'normal' });
            });
        });
    }

    // -------------------------------------------------------------------------
    // Webhook URL copy — settings page only (dedicated button with data-url)
    // -------------------------------------------------------------------------

    $('#pinetree-copy-webhook-url').on('click', function () {
        var url = $(this).data('url');
        if (url) {
            copyText(String(url), $(this));
        }
    });

});
