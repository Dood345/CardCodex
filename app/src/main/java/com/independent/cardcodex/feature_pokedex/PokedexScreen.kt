package com.independent.cardcodex.feature_pokedex

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import coil.compose.AsyncImage
import com.independent.cardcodex.core_database.SpeciesEntity
import com.independent.cardcodex.data.ImportProgress
import com.independent.cardcodex.ui.components.CodexItem

@Composable
fun PokedexScreen(
    onEntryClick: (CodexEntry) -> Unit,
    viewModel: PokedexViewModel = hiltViewModel()
) {
    val codexEntries by viewModel.codexEntries.collectAsState()
    val importProgress by viewModel.importProgress.collectAsState()
    var showImportDialog by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Card Codex") },
                actions = {
                    IconButton(onClick = { showImportDialog = true }) {
                        Text("Import")
                    }
                }
            )
        }
    ) { padding ->
        Column(modifier = Modifier.padding(padding)) {
            if (importProgress !is ImportProgress.Idle && importProgress !is ImportProgress.Completed) {
                ImportStatus(importProgress)
            }

            LazyVerticalGrid(
                columns = GridCells.Adaptive(minSize = 100.dp),
                contentPadding = PaddingValues(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(codexEntries) { entry ->
                    CodexItem(entry, onClick = { onEntryClick(entry) })
                }
            }
        }
    }

    if (showImportDialog) {
        ImportDialog(
            onDismiss = { showImportDialog = false },
            onImport = { url ->
                viewModel.startImport(url)
                showImportDialog = false
            }
        )
    }
}

@Composable
fun ImportStatus(progress: ImportProgress) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(8.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            CircularProgressIndicator(modifier = Modifier.size(24.dp))
            Spacer(modifier = Modifier.width(16.dp))
            Text(
                text = when (progress) {
                    is ImportProgress.Starting -> "Starting import..."
                    is ImportProgress.FetchingSpecies -> "Fetching species..."
                    is ImportProgress.FetchingCards -> "Fetching cards: Set ${progress.current}/${progress.total}"
                    is ImportProgress.Error -> "Error: ${progress.message}"
                    else -> ""
                }
            )
        }
    }
}

@Composable
fun ImportDialog(onDismiss: () -> Unit, onImport: (String) -> Unit) {
    var url by remember { mutableStateOf("https://raw.githubusercontent.com/Dood345/CardCodex/main/manifest.json") } // Default for testing

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Import Manifest") },
        text = {
            OutlinedTextField(
                value = url,
                onValueChange = { url = it },
                label = { Text("Manifest URL") }
            )
        },
        confirmButton = {
            Button(onClick = { onImport(url) }) {
                Text("Import")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        }
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TopAppBar(title: @Composable () -> Unit, actions: @Composable RowScope.() -> Unit = {}) {
    CenterAlignedTopAppBar(
        title = title,
        actions = actions,
        colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer,
            titleContentColor = MaterialTheme.colorScheme.onPrimaryContainer
        )
    )
}
