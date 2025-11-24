package com.independent.cardcodex.data

import retrofit2.http.GET
import retrofit2.http.Url

interface ManifestApi {
    @GET
    suspend fun fetchManifest(@Url url: String): MasterManifest

    @GET
    suspend fun fetchMonsters(@Url url: String): List<MonsterEntry>

    @GET
    suspend fun fetchCards(@Url url: String): List<CardEntry>
}
