
define(["underscore", "backbone", "mustache", "PrairieTemplate", "GameTestHelper", "text!GameTestDetailView.html"], function(_, Backbone, Mustache, PrairieTemplate, GameTestHelper, GameTestDetailViewTemplate) {

    var GameTestDetailView = Backbone.View.extend({

        tagName: 'div',

        events: {
            "click .resetTest": "resetTest",
            "click .resetTestForAll": "resetTestForAll",
        },

        initialize: function() {
            this.appModel = this.options.appModel;
            this.questions = this.options.questions;
            this.listenTo(this.model, "change", this.render);
        },

        render: function() {
            var that = this;
            var data = {};
            data.title = this.model.get("title");
            data.userUID = this.appModel.get("userUID");

            var html = Mustache.render(GameTestDetailViewTemplate, data);
            this.$el.html(html);
        },

        resetTest: function() {
            var that = this;
            this.$('#confirmResetTestModal').on('hidden.bs.modal', function (e) {
                that.trigger("resetTest");
            })
            this.$("#confirmResetTestModal").modal('hide');
        },

        resetTestForAll: function() {
            var that = this;
            this.$('#confirmResetTestForAllModal').on('hidden.bs.modal', function (e) {
                that.trigger("resetTestForAll");
            })
            this.$("#confirmResetTestForAllModal").modal('hide');
        },

        close: function() {
            this.remove();
        }
    });

    return GameTestDetailView;
});