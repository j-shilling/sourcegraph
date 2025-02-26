// Command frontend is the enterprise frontend program.
package main

import (
	"os"

	"github.com/sourcegraph/sourcegraph/enterprise/cmd/frontend/shared"
	"github.com/sourcegraph/sourcegraph/enterprise/cmd/sourcegraph/enterprisecmd"
	"github.com/sourcegraph/sourcegraph/internal/oobmigration"
	"github.com/sourcegraph/sourcegraph/internal/sanitycheck"
	"github.com/sourcegraph/sourcegraph/ui/assets"

	_ "github.com/sourcegraph/sourcegraph/ui/assets/enterprise" // Select enterprise assets
)

func init() {
	// TODO(sqs): TODO(single-binary): could we move this out of init?
	oobmigration.ReturnEnterpriseMigrations = true
}

func main() {
	sanitycheck.Pass()
	if os.Getenv("WEBPACK_DEV_SERVER") == "1" {
		assets.UseDevAssetsProvider()
	}
	enterprisecmd.SingleServiceMainEnterprise(shared.Service)
}
