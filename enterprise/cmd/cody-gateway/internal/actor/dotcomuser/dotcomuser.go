package dotcomuser

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/Khan/genqlient/graphql"
	"github.com/gregjones/httpcache"
	"github.com/sourcegraph/log"

	"github.com/sourcegraph/sourcegraph/enterprise/cmd/cody-gateway/internal/actor"
	"github.com/sourcegraph/sourcegraph/enterprise/cmd/cody-gateway/internal/dotcom"
	"github.com/sourcegraph/sourcegraph/enterprise/internal/codygateway"
	"github.com/sourcegraph/sourcegraph/lib/errors"
)

// dotcom user gateway tokens are always a prefix of 4 characters (sgd_)
// followed by a 64-character hex-encoded SHA256 hash
const tokenLength = 4 + 64

var (
	defaultUpdateInterval = 24 * time.Hour
)

type Source struct {
	log               log.Logger
	cache             httpcache.Cache // cache is expected to be something with automatic TTL
	dotcom            graphql.Client
	concurrencyConfig codygateway.ActorConcurrencyLimitConfig
}

var _ actor.Source = &Source{}

func NewSource(logger log.Logger, cache httpcache.Cache, dotComClient graphql.Client, concurrencyConfig codygateway.ActorConcurrencyLimitConfig) *Source {
	return &Source{
		log:               logger.Scoped("dotcomuser", "dotcom user actor source"),
		cache:             cache,
		dotcom:            dotComClient,
		concurrencyConfig: concurrencyConfig,
	}
}

func (s *Source) Name() string { return string(codygateway.ActorSourceDotcomUser) }

func (s *Source) Get(ctx context.Context, token string) (*actor.Actor, error) {
	// "sgd_" is dotcomUserGatewayAccessTokenPrefix
	if token == "" || !strings.HasPrefix(token, "sgd_") {
		return nil, actor.ErrNotFromSource{}
	}

	if len(token) != tokenLength {
		return nil, errors.New("invalid token format")
	}

	data, hit := s.cache.Get(token)
	if !hit {
		return s.fetchAndCache(ctx, token)
	}

	var act *actor.Actor
	if err := json.Unmarshal(data, &act); err != nil || act == nil {
		s.log.Error("failed to unmarshal actor", log.Error(err))

		// Delete the corrupted record.
		s.cache.Delete(token)

		return s.fetchAndCache(ctx, token)
	}

	if act.LastUpdated == nil || time.Since(*act.LastUpdated) > defaultUpdateInterval {
		return s.fetchAndCache(ctx, token)
	}

	act.Source = s
	return act, nil
}

// fetchAndCache fetches the dotcom user data for the given user token and caches it
func (s *Source) fetchAndCache(ctx context.Context, token string) (*actor.Actor, error) {
	var act *actor.Actor
	resp, checkErr := dotcom.CheckDotcomUserAccessToken(ctx, s.dotcom, token)
	if checkErr != nil {
		// Generate a stateless actor so that we aren't constantly hitting the dotcom API
		act = newActor(s, token, dotcom.DotcomUserState{}, s.concurrencyConfig)
	} else {
		act = newActor(s, token,
			resp.Dotcom.CodyGatewayDotcomUserByToken.DotcomUserState, s.concurrencyConfig)
	}

	if data, err := json.Marshal(act); err != nil {
		s.log.Error("failed to marshal actor",
			log.Error(err))
	} else {
		s.cache.Set(token, data)
	}

	if checkErr != nil {
		return nil, errors.Wrap(checkErr, "failed to validate access token")
	}
	return act, nil
}

// newActor creates an actor from Sourcegraph.com user.
func newActor(source *Source, cacheKey string, user dotcom.DotcomUserState, concurrencyConfig codygateway.ActorConcurrencyLimitConfig) *actor.Actor {
	now := time.Now()
	a := &actor.Actor{
		Key:           cacheKey,
		ID:            user.Username,
		AccessEnabled: user.GetCodyGatewayAccess().Enabled,
		RateLimits:    zeroRequestsAllowed(),
		LastUpdated:   &now,
		Source:        source,
	}

	if rl := user.CodyGatewayAccess.ChatCompletionsRateLimit; rl != nil {
		a.RateLimits[codygateway.FeatureChatCompletions] = actor.NewRateLimitWithPercentageConcurrency(
			rl.Limit,
			time.Duration(rl.IntervalSeconds)*time.Second,
			rl.AllowedModels,
			concurrencyConfig,
		)
	}

	if rl := user.CodyGatewayAccess.CodeCompletionsRateLimit; rl != nil {
		a.RateLimits[codygateway.FeatureCodeCompletions] = actor.NewRateLimitWithPercentageConcurrency(
			rl.Limit,
			time.Duration(rl.IntervalSeconds)*time.Second,
			rl.AllowedModels,
			concurrencyConfig,
		)
	}

	if rl := user.CodyGatewayAccess.EmbeddingsRateLimit; rl != nil {
		a.RateLimits[codygateway.FeatureEmbeddings] = actor.NewRateLimitWithPercentageConcurrency(
			rl.Limit,
			time.Duration(rl.IntervalSeconds)*time.Second,
			rl.AllowedModels,
			concurrencyConfig,
		)
	}

	return a
}

func zeroRequestsAllowed() map[codygateway.Feature]actor.RateLimit {
	return map[codygateway.Feature]actor.RateLimit{
		codygateway.FeatureChatCompletions: {},
		codygateway.FeatureCodeCompletions: {},
		codygateway.FeatureEmbeddings:      {},
	}
}
