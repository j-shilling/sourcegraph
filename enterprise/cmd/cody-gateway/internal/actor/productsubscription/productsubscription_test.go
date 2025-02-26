package productsubscription

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/sourcegraph/sourcegraph/enterprise/cmd/cody-gateway/internal/dotcom"
	"github.com/sourcegraph/sourcegraph/enterprise/internal/codygateway"
)

func TestNewActor(t *testing.T) {
	concurrencyConfig := codygateway.ActorConcurrencyLimitConfig{
		Percentage: 50,
		Interval:   24 * time.Hour,
	}
	type args struct {
		s               dotcom.ProductSubscriptionState
		devLicensesOnly bool
	}
	tests := []struct {
		name        string
		args        args
		wantEnabled bool
	}{
		{
			name: "not dev only",
			args: args{
				dotcom.ProductSubscriptionState{
					CodyGatewayAccess: dotcom.ProductSubscriptionStateCodyGatewayAccess{
						CodyGatewayAccessFields: dotcom.CodyGatewayAccessFields{
							Enabled: true,
							ChatCompletionsRateLimit: &dotcom.CodyGatewayAccessFieldsChatCompletionsRateLimitCodyGatewayRateLimit{
								RateLimitFields: dotcom.RateLimitFields{
									Limit:           10,
									IntervalSeconds: 10,
								},
							},
							CodeCompletionsRateLimit: &dotcom.CodyGatewayAccessFieldsCodeCompletionsRateLimitCodyGatewayRateLimit{
								RateLimitFields: dotcom.RateLimitFields{
									Limit:           10,
									IntervalSeconds: 10,
								},
							},
						},
					},
				},
				false,
			},
			wantEnabled: true,
		},
		{
			name: "dev only, not a dev license",
			args: args{
				dotcom.ProductSubscriptionState{
					CodyGatewayAccess: dotcom.ProductSubscriptionStateCodyGatewayAccess{
						CodyGatewayAccessFields: dotcom.CodyGatewayAccessFields{
							Enabled: true,
							ChatCompletionsRateLimit: &dotcom.CodyGatewayAccessFieldsChatCompletionsRateLimitCodyGatewayRateLimit{
								RateLimitFields: dotcom.RateLimitFields{
									Limit:           10,
									IntervalSeconds: 10,
								},
							},
							CodeCompletionsRateLimit: &dotcom.CodyGatewayAccessFieldsCodeCompletionsRateLimitCodyGatewayRateLimit{
								RateLimitFields: dotcom.RateLimitFields{
									Limit:           10,
									IntervalSeconds: 10,
								},
							},
						},
					},
				},
				true,
			},
			wantEnabled: false,
		},
		{
			name: "dev only, is a dev license",
			args: args{
				dotcom.ProductSubscriptionState{
					CodyGatewayAccess: dotcom.ProductSubscriptionStateCodyGatewayAccess{
						CodyGatewayAccessFields: dotcom.CodyGatewayAccessFields{
							Enabled: true,
							ChatCompletionsRateLimit: &dotcom.CodyGatewayAccessFieldsChatCompletionsRateLimitCodyGatewayRateLimit{
								RateLimitFields: dotcom.RateLimitFields{
									Limit:           10,
									IntervalSeconds: 10,
								},
							},
							CodeCompletionsRateLimit: &dotcom.CodyGatewayAccessFieldsCodeCompletionsRateLimitCodyGatewayRateLimit{
								RateLimitFields: dotcom.RateLimitFields{
									Limit:           10,
									IntervalSeconds: 10,
								},
							},
						},
					},
					ActiveLicense: &dotcom.ProductSubscriptionStateActiveLicenseProductLicense{
						Info: &dotcom.ProductSubscriptionStateActiveLicenseProductLicenseInfo{
							Tags: []string{"dev"},
						},
					},
				},
				true,
			},
			wantEnabled: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			act := newActor(nil, "", tt.args.s, tt.args.devLicensesOnly, concurrencyConfig)
			assert.Equal(t, act.AccessEnabled, tt.wantEnabled)
		})
	}
}
