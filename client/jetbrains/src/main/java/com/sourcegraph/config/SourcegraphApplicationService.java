package com.sourcegraph.config;

import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.components.PersistentStateComponent;
import com.intellij.openapi.components.State;
import com.intellij.openapi.components.Storage;
import com.sourcegraph.find.Search;
import org.apache.commons.lang.StringUtils;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

@State(
    name = "ApplicationConfig",
    storages = {@Storage("sourcegraph.xml")})
public class SourcegraphApplicationService
    implements PersistentStateComponent<SourcegraphApplicationService>, SourcegraphService {
  @Nullable public String instanceType;
  @Nullable public String url;

  @Nullable
  @Deprecated(since = "3.0.0-alpha.2", forRemoval = true)
  public String accessToken; // kept for backwards compatibility

  @Nullable public String dotComAccessToken;
  @Nullable public String enterpriseAccessToken;
  @Nullable public String customRequestHeaders;
  @Nullable public String defaultBranch;
  @Nullable public String remoteUrlReplacements;
  @Nullable public String anonymousUserId;
  public boolean isInstallEventLogged;
  public boolean isUrlNotificationDismissed;
  public boolean isAccessTokenNotificationDismissed;
  @Nullable public Boolean authenticationFailedLastTime;

  @Nullable
  public String
      lastUpdateNotificationPluginVersion; // The version of the plugin that last notified the user

  // about an update

  @NotNull
  public static SourcegraphApplicationService getInstance() {
    return ApplicationManager.getApplication().getService(SourcegraphApplicationService.class);
  }

  @Nullable
  public String getInstanceType() {
    return instanceType;
  }

  @Nullable
  public String getSourcegraphUrl() {
    return url;
  }

  @Nullable
  public String getDotComAccessToken() {
    return dotComAccessToken;
  }

  @Nullable
  public String getCustomRequestHeaders() {
    return customRequestHeaders;
  }

  @Nullable
  public String getDefaultBranchName() {
    return defaultBranch;
  }

  @Nullable
  public String getRemoteUrlReplacements() {

    return remoteUrlReplacements;
  }

  @Override
  @Nullable
  public Search getLastSearch() {
    // TODO
    return null;
  }

  @Override
  @Nullable
  public String getEnterpriseAccessToken() {
    // configuring enterpriseAccessToken overrides the deprecated accessToken field
    String configuredEnterpriseAccessToken =
        StringUtils.isEmpty(enterpriseAccessToken) ? accessToken : enterpriseAccessToken;
    // defaulting to SRC_ACCESS_TOKEN env if nothing else was configured
    return configuredEnterpriseAccessToken == null
        ? System.getenv("SRC_ACCESS_TOKEN")
        : configuredEnterpriseAccessToken;
  }

  @Override
  public boolean areChatPredictionsEnabled() {
    // TODO
    return false;
  }

  @Override
  public String getCodebase() {
    // TODO
    return null;
  }

  @Nullable
  public String getAnonymousUserId() {
    return anonymousUserId;
  }

  public boolean isInstallEventLogged() {
    return isInstallEventLogged;
  }

  public boolean isUrlNotificationDismissed() {
    return isUrlNotificationDismissed;
  }

  public boolean isAccessTokenNotificationDismissed() {
    return isAccessTokenNotificationDismissed;
  }

  @Nullable
  public Boolean getAuthenticationFailedLastTime() {
    return authenticationFailedLastTime;
  }

  @Nullable
  public String getLastUpdateNotificationPluginVersion() {
    return lastUpdateNotificationPluginVersion;
  }

  @Nullable
  public SourcegraphApplicationService getState() {
    return this;
  }

  @Override
  public void loadState(@NotNull SourcegraphApplicationService settings) {
    this.instanceType = settings.instanceType;
    this.url = settings.url;
    this.accessToken = settings.accessToken;
    this.dotComAccessToken = settings.dotComAccessToken;
    this.enterpriseAccessToken = settings.enterpriseAccessToken;
    this.customRequestHeaders = settings.customRequestHeaders;
    this.defaultBranch = settings.defaultBranch;
    this.remoteUrlReplacements = settings.remoteUrlReplacements;
    this.anonymousUserId = settings.anonymousUserId;
    this.isUrlNotificationDismissed = settings.isUrlNotificationDismissed;
    this.isAccessTokenNotificationDismissed = settings.isAccessTokenNotificationDismissed;
    this.authenticationFailedLastTime = settings.authenticationFailedLastTime;
    this.lastUpdateNotificationPluginVersion = settings.lastUpdateNotificationPluginVersion;
  }
}
